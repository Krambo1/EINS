import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_KEEP,
  DEFAULT_MAX_BYTES,
  createLineSplitter,
  createRotatingLog,
  rotateFiles,
} from "./rotating-log.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eins-log-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = (name: string): string => readFileSync(join(dir, name), "utf8");
const names = (): string[] => readdirSync(dir).sort();

describe("defaults", () => {
  it("10 MB x 5 files", () => {
    expect(DEFAULT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DEFAULT_KEEP).toBe(5);
  });
});

describe("createRotatingLog: lines", () => {
  it("prefixes every line with an ISO-8601 timestamp", () => {
    const t = new Date("2026-10-07T01:02:03.456Z");
    const log = createRotatingLog({ dir, now: () => t });
    log.writeLine("hello");
    log.writeLine("world");
    log.close();
    expect(read("agent.log")).toBe(
      "2026-10-07T01:02:03.456Z hello\n2026-10-07T01:02:03.456Z world\n"
    );
  });

  it("splits embedded newlines into separate stamped lines and skips empty ones", () => {
    const log = createRotatingLog({ dir, now: () => new Date("2026-01-01T00:00:00.000Z") });
    log.writeLine("a\r\nb\n\nc");
    log.close();
    expect(read("agent.log").trimEnd().split("\n")).toEqual([
      "2026-01-01T00:00:00.000Z a",
      "2026-01-01T00:00:00.000Z b",
      "2026-01-01T00:00:00.000Z c",
    ]);
  });

  it("creates the log directory (logs\\ under the data dir) if missing", () => {
    const nested = join(dir, "logs");
    const log = createRotatingLog({ dir: nested });
    log.writeLine("x");
    log.close();
    expect(existsSync(join(nested, "agent.log"))).toBe(true);
  });

  it("appends to an existing file across restarts", () => {
    const first = createRotatingLog({ dir });
    first.writeLine("one");
    first.close();
    const second = createRotatingLog({ dir });
    second.writeLine("two");
    second.close();
    const lines = read("agent.log").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/ one$/);
    expect(lines[1]).toMatch(/ two$/);
  });

  it("echoes to the sink without the timestamp, and a throwing sink does not break logging", () => {
    const echoed: string[] = [];
    const log = createRotatingLog({
      dir,
      echo: (l) => {
        echoed.push(l);
        if (l === "boom") throw new Error("console gone");
      },
    });
    log.writeLine("boom");
    log.writeLine("after");
    log.close();
    expect(echoed).toEqual(["boom", "after"]);
    expect(read("agent.log").trimEnd().split("\n")).toHaveLength(2);
  });
});

describe("createRotatingLog: size rotation", () => {
  it("rotates when the file would exceed maxBytes and keeps `keep` old files", () => {
    const log = createRotatingLog({ dir, maxBytes: 300, keep: 3 });
    for (let i = 0; i < 120; i++) log.writeLine(`line-${String(i).padStart(3, "0")}-xxxxxxxxxx`);
    log.close();

    expect(names()).toEqual(["agent.log", "agent.log.1", "agent.log.2", "agent.log.3"]);
    // No file grew past the limit (a line never straddles a rotation).
    for (const n of names()) expect(statSync(join(dir, n)).size).toBeLessThanOrEqual(300);
    // Newest data in agent.log, older in .1 then .2 then .3 (oldest).
    const last = (f: string): string => read(f).trimEnd().split("\n").at(-1)!;
    expect(last("agent.log")).toMatch(/line-119/);
    const firstOf = (f: string): number =>
      Number(/line-(\d+)/.exec(read(f))![1]);
    expect(firstOf("agent.log")).toBeGreaterThan(firstOf("agent.log.1"));
    expect(firstOf("agent.log.1")).toBeGreaterThan(firstOf("agent.log.2"));
    expect(firstOf("agent.log.2")).toBeGreaterThan(firstOf("agent.log.3"));
    // The oldest lines are gone (bounded disk use), none out of order.
    expect(firstOf("agent.log.3")).toBeGreaterThan(0);
  });

  it("never loses a line that fits: every line in the retained window is intact", () => {
    const log = createRotatingLog({ dir, maxBytes: 500, keep: 5 });
    const total = 40;
    for (let i = 0; i < total; i++) log.writeLine(`event-${i}`);
    log.close();
    const all = ["agent.log.5", "agent.log.4", "agent.log.3", "agent.log.2", "agent.log.1", "agent.log"]
      .filter((n) => existsSync(join(dir, n)))
      .map(read)
      .join("")
      .trimEnd()
      .split("\n");
    expect(all).toHaveLength(total); // 40 short lines fit in the 6 x 500 bytes window
    all.forEach((l, i) => expect(l).toMatch(new RegExp(` event-${i}$`)));
  });

  it("a rotation never happens for an empty file even if one line exceeds maxBytes", () => {
    const log = createRotatingLog({ dir, maxBytes: 10, keep: 2 });
    log.writeLine("this single line is much longer than ten bytes");
    log.close();
    expect(names()).toEqual(["agent.log"]);
  });
});

describe("rotateFiles", () => {
  it("shifts .1 -> .2 ... and drops the oldest", () => {
    const base = join(dir, "agent.log");
    writeFileSync(base, "live");
    for (let i = 1; i <= 5; i++) writeFileSync(`${base}.${i}`, `old${i}`);
    rotateFiles(base, 5);
    expect(existsSync(base)).toBe(false);
    expect(read("agent.log.1")).toBe("live");
    expect(read("agent.log.2")).toBe("old1");
    expect(read("agent.log.5")).toBe("old4"); // old5 was the oldest and is gone
    expect(names()).not.toContain("agent.log.6");
    expect(names().some((n) => n.endsWith(".rotating"))).toBe(false);
  });

  it("a half-failed rotation leaves the history in place and the live log recoverable", () => {
    const base = join(dir, "agent.log");
    writeFileSync(base, "live");
    writeFileSync(`${base}.1`, "previous");
    // A non-empty DIRECTORY where the oldest file should be makes the delete throw.
    mkdirSync(`${base}.3`);
    writeFileSync(join(`${base}.3`, "keep"), "x");
    expect(() => rotateFiles(base, 3)).toThrow();
    // The previous newest log was NOT overwritten by the live one...
    expect(read("agent.log.1")).toBe("previous");
    // ...and the live content survives under the staged name.
    const staged = names().filter((n) => n.startsWith("agent.log.rotating"));
    expect(staged).toHaveLength(1);
    expect(read(staged[0]!)).toBe("live");
  });

  it("a second failed rotation does not overwrite the first staged file", () => {
    const base = join(dir, "agent.log");
    writeFileSync(`${base}.1`, "previous");
    mkdirSync(`${base}.2`);
    writeFileSync(join(`${base}.2`, "keep"), "x");
    writeFileSync(base, "live-1");
    expect(() => rotateFiles(base, 2)).toThrow();
    writeFileSync(base, "live-2");
    expect(() => rotateFiles(base, 2)).toThrow();
    const stagedContents = names()
      .filter((n) => n.startsWith("agent.log.rotating"))
      .map(read)
      .sort();
    expect(stagedContents).toEqual(["live-1", "live-2"]);
  });

  it("nothing to rotate is a no-op", () => {
    expect(() => rotateFiles(join(dir, "agent.log"), 5)).not.toThrow();
    expect(names()).toEqual([]);
  });
});

describe("createRotatingLog: never throws", () => {
  it("an unusable log directory (a file is in the way) drops lines and counts them", () => {
    const blocker = join(dir, "logs");
    writeFileSync(blocker, "i am a file, not a directory");
    const log = createRotatingLog({ dir: blocker });
    expect(() => log.writeLine("a")).not.toThrow();
    expect(() => log.writeLine("b")).not.toThrow();
    expect(log.droppedLines()).toBe(2);
    expect(() => log.close()).not.toThrow();
  });

  it("keeps logging in the current file when rotation is refused, then retries later", () => {
    let nowMs = Date.parse("2026-10-07T00:00:00.000Z");
    const log = createRotatingLog({ dir, maxBytes: 100, keep: 2, now: () => new Date(nowMs) });
    // Make the rotation impossible: a non-empty directory occupies the oldest slot.
    mkdirSync(join(dir, "agent.log.2"));
    writeFileSync(join(dir, "agent.log.2", "x"), "x");
    for (let i = 0; i < 20; i++) log.writeLine(`line-${i}-xxxxxxxxxxxxxxxx`);
    // Still logging, nothing thrown, and the live file keeps receiving lines.
    expect(read("agent.log")).toMatch(/line-19-/);
    expect(log.droppedLines()).toBe(0);
    // After the retry delay and with the obstacle gone, rotation happens.
    rmSync(join(dir, "agent.log.2"), { recursive: true, force: true });
    nowMs += 61_000;
    for (let i = 20; i < 30; i++) log.writeLine(`line-${i}-xxxxxxxxxxxxxxxx`);
    log.close();
    expect(existsSync(join(dir, "agent.log.1"))).toBe(true);
  });
});

describe("createLineSplitter", () => {
  it("emits whole lines across chunk boundaries and strips CR", () => {
    const out: string[] = [];
    const s = createLineSplitter((l) => out.push(l));
    s.push("hel");
    s.push("lo\r\nwor");
    s.push("ld\n\nlast");
    expect(out).toEqual(["hello", "world"]);
    s.flush();
    expect(out).toEqual(["hello", "world", "last"]);
  });

  it("does not corrupt a multi-byte character split across two chunks", () => {
    const out: string[] = [];
    const s = createLineSplitter((l) => out.push(l));
    const bytes = Buffer.from("Prüfung fertig ä\n", "utf8");
    // Split in the middle of the two-byte "ü" and of "ä".
    const cut1 = bytes.indexOf(0xc3) + 1;
    const cut2 = bytes.lastIndexOf(0xc3) + 1;
    s.push(bytes.subarray(0, cut1));
    s.push(bytes.subarray(cut1, cut2));
    s.push(bytes.subarray(cut2));
    expect(out).toEqual(["Prüfung fertig ä"]);
  });

  it("flushes a final partial line and bounds a runaway line", () => {
    const out: string[] = [];
    const s = createLineSplitter((l) => out.push(l));
    s.push("x".repeat(70 * 1024));
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBe(70 * 1024);
    s.push("tail");
    s.flush();
    expect(out.at(-1)).toBe("tail");
  });
});
