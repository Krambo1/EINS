import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXIT_LOCK_HELD,
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_MS,
  acquireInstanceLock,
  describeLockHolder,
  inspectLock,
} from "./instance-lock.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eins-lock-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const lockFile = (name = "agent.lock"): string => join(dir, name);

/** Write a lock file as another process would have, with a chosen age. */
function plantLock(opts: {
  pid: number;
  token?: string;
  ageMs?: number;
  name?: string;
  raw?: string;
}): void {
  const path = lockFile(opts.name);
  writeFileSync(
    path,
    opts.raw ??
      JSON.stringify({
        pid: opts.pid,
        startedAt: "2026-10-07T01:00:00.000Z",
        token: opts.token ?? "othertoken",
      })
  );
  if (opts.ageMs !== undefined) {
    const t = new Date(Date.now() - opts.ageMs);
    utimesSync(path, t, t);
  }
}

const deadPid = (): boolean => false;
const alivePid = (): boolean => true;

describe("exit code", () => {
  it("is 75", () => {
    expect(EXIT_LOCK_HELD).toBe(75);
  });
});

describe("acquireInstanceLock", () => {
  it("creates the lock with pid, start time and a token", () => {
    const r = acquireInstanceLock({ dir, pid: 4242, now: () => Date.UTC(2026, 9, 7, 3, 0, 0) });
    expect(r.acquired).toBe(true);
    const body = JSON.parse(readFileSync(lockFile(), "utf8"));
    expect(body.pid).toBe(4242);
    expect(body.startedAt).toBe("2026-10-07T03:00:00.000Z");
    expect(body.token).toMatch(/^[0-9a-f]{16}$/);
    if (r.acquired) r.lock.releaseSync();
  });

  it("creates the data directory when it does not exist yet", () => {
    const nested = join(dir, "a", "b");
    const r = acquireInstanceLock({ dir: nested });
    expect(r.acquired).toBe(true);
    expect(existsSync(join(nested, "agent.lock"))).toBe(true);
    if (r.acquired) r.lock.releaseSync();
  });

  it("a second start while a LIVE agent holds the lock is refused with the holder's details", () => {
    plantLock({ pid: 777, ageMs: 5_000 });
    const r = acquireInstanceLock({ dir, pid: 1000, isPidAlive: alivePid });
    expect(r.acquired).toBe(false);
    if (!r.acquired) {
      expect(r.holder).toEqual({ pid: 777, startedAt: "2026-10-07T01:00:00.000Z" });
      expect(r.ageMs).toBeGreaterThanOrEqual(5_000 - 50);
    }
    // And the holder's file is untouched.
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe("othertoken");
  });

  it("a lock whose process is DEAD is stale and is taken over", () => {
    plantLock({ pid: 777, ageMs: 5_000 });
    const r = acquireInstanceLock({ dir, pid: 1000, isPidAlive: deadPid });
    expect(r.acquired).toBe(true);
    if (r.acquired) {
      expect(r.tookOverStale).toMatch(/process 777 is not running/);
      expect(JSON.parse(readFileSync(lockFile(), "utf8")).pid).toBe(1000);
      r.lock.releaseSync();
    }
  });

  it("a lock whose PID is alive but UNREFRESHED for a minute is stale (reboot + PID reuse)", () => {
    plantLock({ pid: 777, ageMs: LOCK_STALE_MS + 5_000 });
    const r = acquireInstanceLock({ dir, pid: 1000, isPidAlive: alivePid });
    expect(r.acquired).toBe(true);
    if (r.acquired) {
      expect(r.tookOverStale).toMatch(/has not refreshed the lock/);
      r.lock.releaseSync();
    }
  });

  it("a lock recorded by this very PID is stale (a previous run of this PID number)", () => {
    plantLock({ pid: 1000, ageMs: 1_000 });
    const r = acquireInstanceLock({ dir, pid: 1000, isPidAlive: alivePid });
    expect(r.acquired).toBe(true);
    if (r.acquired) r.lock.releaseSync();
  });

  it("a half-written (unparseable) FRESH lock is treated as held; an OLD one is taken over", () => {
    plantLock({ pid: 0, raw: "{not json", ageMs: 1_000 });
    const fresh = acquireInstanceLock({ dir, pid: 1000, isPidAlive: alivePid });
    expect(fresh.acquired).toBe(false);
    if (!fresh.acquired) expect(fresh.holder).toEqual({ pid: null, startedAt: null });

    plantLock({ pid: 0, raw: "{not json", ageMs: LOCK_STALE_MS + 1_000 });
    const old = acquireInstanceLock({ dir, pid: 1000, isPidAlive: alivePid });
    expect(old.acquired).toBe(true);
    if (old.acquired) old.lock.releaseSync();
  });

  it("uses the real liveness probe: our own live process holds a fresh lock against a different pid", () => {
    plantLock({ pid: process.pid, ageMs: 1_000 });
    const r = acquireInstanceLock({ dir, pid: process.pid + 100_000 });
    expect(r.acquired).toBe(false);
  });

  it("uses the real liveness probe: a PID that does not exist is stale", () => {
    // 0x7fffffff is above any real PID on Windows and Linux.
    plantLock({ pid: 2147483646, ageMs: 1_000 });
    const r = acquireInstanceLock({ dir, pid: 1000 });
    expect(r.acquired).toBe(true);
    if (r.acquired) r.lock.releaseSync();
  });

  it("the supervisor and the agent use separate lock files in the same directory", () => {
    const a = acquireInstanceLock({ dir, name: "agent.lock", pid: 1 });
    const s = acquireInstanceLock({ dir, name: "supervisor.lock", pid: 2 });
    expect(a.acquired).toBe(true);
    expect(s.acquired).toBe(true);
    if (a.acquired) a.lock.releaseSync();
    if (s.acquired) s.lock.releaseSync();
  });
});

describe("release", () => {
  it("removes the lock on clean shutdown, idempotently", () => {
    const r = acquireInstanceLock({ dir });
    expect(r.acquired).toBe(true);
    if (!r.acquired) return;
    r.lock.releaseSync();
    expect(existsSync(lockFile())).toBe(false);
    expect(() => r.lock.releaseSync()).not.toThrow();
  });

  it("does not delete a lock that another process has taken over", () => {
    const r = acquireInstanceLock({ dir, pid: 1000 });
    expect(r.acquired).toBe(true);
    if (!r.acquired) return;
    plantLock({ pid: 2000, token: "thieftoken" });
    r.lock.releaseSync();
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe("thieftoken");
  });

  it("after release a new agent can start", () => {
    const first = acquireInstanceLock({ dir, pid: 1000, isPidAlive: alivePid });
    if (first.acquired) first.lock.releaseSync();
    const second = acquireInstanceLock({ dir, pid: 2000, isPidAlive: alivePid });
    expect(second.acquired).toBe(true);
    if (second.acquired) second.lock.releaseSync();
  });
});

describe("inspectLock", () => {
  it("none when there is no file", () => {
    expect(inspectLock(dir)).toEqual({ state: "none" });
  });

  it("live / stale classification", () => {
    plantLock({ pid: 5, ageMs: 1_000 });
    expect(inspectLock(dir, "agent.lock", { pid: 9, isPidAlive: alivePid }).state).toBe("live");
    expect(inspectLock(dir, "agent.lock", { pid: 9, isPidAlive: deadPid }).state).toBe("stale");
  });

  it("does not modify the lock", () => {
    plantLock({ pid: 5, ageMs: 1_000 });
    inspectLock(dir, "agent.lock", { pid: 9, isPidAlive: deadPid });
    expect(existsSync(lockFile())).toBe(true);
  });
});

describe("heartbeat", () => {
  it("refreshes the file's mtime so a live agent never looks stale", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const r = acquireInstanceLock({ dir, pid: 1000, now: () => Date.now() });
    expect(r.acquired).toBe(true);
    if (!r.acquired) return;
    const old = new Date(Date.now() - 50_000);
    utimesSync(lockFile(), old, old);
    const before = statSync(lockFile()).mtimeMs;
    r.lock.startHeartbeat(() => {
      throw new Error("must not be lost");
    });
    vi.advanceTimersByTime(LOCK_HEARTBEAT_MS + 100);
    expect(statSync(lockFile()).mtimeMs).toBeGreaterThan(before + 10_000);
    r.lock.releaseSync();
  });

  it("detects a takeover (frozen process) and reports it once", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const r = acquireInstanceLock({ dir, pid: 1000, now: () => Date.now() });
    expect(r.acquired).toBe(true);
    if (!r.acquired) return;
    const lost: string[] = [];
    r.lock.startHeartbeat((reason) => lost.push(reason));
    plantLock({ pid: 2000, token: "successor" });
    vi.advanceTimersByTime(LOCK_HEARTBEAT_MS * 3);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatch(/taken over or removed/);
    // The successor's lock is untouched.
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe("successor");
  });

  it("detects a deleted lock file", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const r = acquireInstanceLock({ dir, pid: 1000, now: () => Date.now() });
    if (!r.acquired) throw new Error("expected acquired");
    const lost: string[] = [];
    r.lock.startHeartbeat((reason) => lost.push(reason));
    rmSync(lockFile());
    vi.advanceTimersByTime(LOCK_HEARTBEAT_MS + 100);
    expect(lost).toHaveLength(1);
  });

  it("stopHeartbeat / releaseSync stop the timer", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const r = acquireInstanceLock({ dir, pid: 1000, now: () => Date.now() });
    if (!r.acquired) throw new Error("expected acquired");
    const lost = vi.fn();
    r.lock.startHeartbeat(lost);
    r.lock.releaseSync();
    plantLock({ pid: 2000, token: "later" });
    vi.advanceTimersByTime(LOCK_HEARTBEAT_MS * 4);
    expect(lost).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("describeLockHolder", () => {
  it("names the PID and start time in German and English and the file to delete", () => {
    const text = describeLockHolder(
      { pid: 4711, startedAt: "2026-10-07T01:00:00.000Z" },
      "C:\\ProgramData\\EINS-Agent\\agent.lock"
    );
    expect(text).toContain("PID 4711");
    expect(text).toContain("gestartet 2026-10-07T01:00:00.000Z");
    expect(text).toContain("started 2026-10-07T01:00:00.000Z");
    expect(text).toContain("agent.lock");
    expect(text).toMatch(/läuft bereits/);
    expect(text).toMatch(/already running/);
  });

  it("copes with an unknown holder", () => {
    const text = describeLockHolder({ pid: null, startedAt: null }, "x");
    expect(text).toContain("PID unbekannt");
    expect(text).toContain("PID unknown");
  });
});

describe("heartbeat: transient file errors (antivirus / backup holding the lock)", () => {
  const busy = (code: string) => (): never => {
    throw Object.assign(new Error(`${code}: resource busy or locked`), { code });
  };

  for (const code of ["EBUSY", "EPERM", "EACCES"]) {
    it(`${code} on the periodic check is NOT "lock lost"; logged once; recovers`, () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      const logs: string[] = [];
      let failing = true;
      const r = acquireInstanceLock({
        dir,
        pid: 1000,
        now: () => Date.now(),
        log: (m) => logs.push(m),
        readLockFn: (path) => {
          if (failing) busy(code)();
          return null as never;
        },
      });
      if (!r.acquired) throw new Error("expected acquired");
      const lost = vi.fn();
      r.lock.startHeartbeat(lost);
      vi.advanceTimersByTime(LOCK_HEARTBEAT_MS * 4);
      expect(lost).not.toHaveBeenCalled();
      expect(logs.filter((l) => l.includes(code))).toHaveLength(1);
      failing = false;
      r.lock.releaseSync();
    });
  }

  it("gives up only after the failures span about 10 minutes", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const r = acquireInstanceLock({
      dir,
      pid: 1000,
      now: () => Date.now(),
      log: () => {},
      readLockFn: busy("EBUSY"),
    });
    if (!r.acquired) throw new Error("expected acquired");
    const lost: string[] = [];
    r.lock.startHeartbeat((reason) => lost.push(reason));
    vi.advanceTimersByTime(9 * 60_000);
    expect(lost).toHaveLength(0);
    vi.advanceTimersByTime(2 * 60_000);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatch(/EBUSY|unreadable|could not be read/i);
  });

  it("a successful check resets the transient window", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    let failing = true;
    const r = acquireInstanceLock({
      dir,
      pid: 1000,
      now: () => Date.now(),
      log: () => {},
      readLockFn: (path) => {
        if (failing) busy("EPERM")();
        return {
          info: { pid: 1000, startedAt: "", token: JSON.parse(readFileSync(path, "utf8")).token },
          mtimeMs: Date.now(),
        };
      },
    });
    if (!r.acquired) throw new Error("expected acquired");
    const lost = vi.fn();
    r.lock.startHeartbeat(lost);
    vi.advanceTimersByTime(8 * 60_000);
    failing = false;
    vi.advanceTimersByTime(LOCK_HEARTBEAT_MS * 2);
    failing = true;
    vi.advanceTimersByTime(8 * 60_000);
    expect(lost).not.toHaveBeenCalled();
    r.lock.releaseSync();
  });
});
