import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { stat as realStat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Integration tests for the GDT inbox watcher against a real folder and the
 * real (encrypted) outbox + file ledger. File names and Satz layout follow
 * the GDT 2.1 spec (section 2.3: `<Empfänger><Sender>.NNN` or `.GDT`,
 * receiver deletes after reading, FIFO).
 */

let tempDir: string;
let gdtDir: string;

vi.mock("./config.js", () => ({
  outboxPath: () => join(tempDir, "outbox.sqlite"),
}));

let outbox: typeof import("./outbox");
let watcherMod: typeof import("./watcher");
let healthMod: typeof import("./file-watcher-health");
let handle: import("./watcher").GdtWatcherHandle | null = null;

const CLINIC = "00000000-0000-0000-0000-000000000001";

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "eins-gdt-watch-"));
  gdtDir = join(tempDir, "GDT");
  mkdirSync(gdtDir);
  vi.resetModules();
  outbox = await import("./outbox.js");
  outbox.setOutboxKey("c".repeat(64));
  watcherMod = await import("./watcher.js");
  healthMod = await import("./file-watcher-health.js");
});

afterEach(async () => {
  await handle?.stop();
  handle = null;
  outbox._closeForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function gdt(lines: Array<[string, string]>, opts: { finalCrlf?: boolean } = {}): Buffer {
  let body = "";
  for (const [fk, value] of lines) {
    const payload = `${fk}${value}`;
    body += `${String(3 + payload.length + 2).padStart(3, "0")}${payload}\r\n`;
  }
  if (opts.finalCrlf === false) body = body.slice(0, -2);
  return Buffer.from(body, "latin1");
}

function patient(id: string, receiver = "EINS"): Buffer {
  return gdt([
    ["8000", "6301"],
    ["8315", receiver],
    ["8316", "PVS"],
    ["3000", id],
    ["3101", "Muster"],
    ["3102", "Anna"],
  ]);
}

/** Write a file and backdate it so it counts as stable. */
function drop(name: string, bytes: Buffer, ageMs = 60_000): string {
  const p = join(gdtDir, name);
  writeFileSync(p, bytes);
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(p, t, t);
  return p;
}

function start(extra: Partial<Parameters<typeof watcherMod.watchFolder>[0]> = {}) {
  handle = watcherMod.watchFolder({
    folder: gdtDir,
    clinicId: CLINIC,
    useChokidar: false,
    rescanIntervalMs: 3_600_000,
    stabilityMs: 0,
    tornGraceMs: 10_000,
    ...extra,
  });
  return handle;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function health() {
  return healthMod.gdtWatcherHealth(handle!.status())[0];
}

function queuedPatientIds(): string[] {
  return outbox.dueRows(1000).map((r) => JSON.parse(r.payload).pvsPatientId as string);
}

describe("GDT watcher: consume addressed files (spec 2.3)", () => {
  it("consumes a fixed-name .GDT file: events durable, file deleted, channel free again", async () => {
    drop("EINSPVS.GDT", patient("4711"));
    const w = start();
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["4711"]);
    expect(existsSync(join(gdtDir, "EINSPVS.GDT"))).toBe(false);
    expect(readdirSync(join(gdtDir, ".eins", "processing"))).toEqual([]);
    expect(w.status()).toMatchObject({ consumedFiles: 1, eventsEnqueued: 1 });
    // The PVS writes its next export under the same name.
    drop("EINSPVS.GDT", patient("4712"));
    await w.rescanNow();
    expect(queuedPatientIds().sort()).toEqual(["4711", "4712"]);
  });

  it("consumes counting .001/.002 files FIFO by modification time", async () => {
    drop("EINSPVS.002", patient("B"), 30_000);
    drop("EINSPVS.001", patient("A"), 60_000);
    const w = start();
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["A", "B"]);
    expect(readdirSync(gdtDir).filter((f) => f !== ".eins")).toEqual([]);
  });

  it("accepts a file addressed via FK 8315 even if its name does not start with the id", async () => {
    drop("PATIENT.GDT", patient("9", "EINS"));
    const w = start();
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["9"]);
    expect(existsSync(join(gdtDir, "PATIENT.GDT"))).toBe(false);
  });

  it("honours a custom receiver id", async () => {
    drop("EIN2PVS.001", patient("1", "EIN2"));
    const w = start({ receiverId: "EIN2" });
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["1"]);
  });
});

describe("GDT watcher: never touches other devices' files", () => {
  it("leaves a file for the ECG device untouched and unread into the outbox", async () => {
    const ekg = gdt([
      ["8000", "6302"],
      ["8315", "EKG1"],
      ["8316", "EDV1"],
      ["3000", "4711"],
      ["8402", "EKG01"],
    ]);
    drop("EKG1EDV1.001", ekg);
    const devResult = gdt([
      ["8000", "6310"],
      ["8315", "EDV1"],
      ["8316", "EKG1"],
      ["3000", "4711"],
      ["8420", "120"],
    ]);
    drop("EDV1EKG1.001", devResult);
    const w = start();
    await w.rescanNow();
    await w.rescanNow();
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(join(gdtDir, "EKG1EDV1.001"))).toBe(true);
    expect(existsSync(join(gdtDir, "EDV1EKG1.001"))).toBe(true);
    expect(w.status().ignoredFiles).toBe(2);
  });
});

describe("GDT watcher: FK 8315 decides over the file name", () => {
  it("leaves a file named EINS... that FK 8315 addresses to another receiver", async () => {
    drop("EINSTEIN.001", patient("5", "EKG1"));
    const w = start();
    await w.rescanNow();
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(join(gdtDir, "EINSTEIN.001"))).toBe(true);
  });

  it("leaves a device→PVS Satz (6310) untouched even when addressed to EINS", async () => {
    const result = gdt([
      ["8000", "6310"],
      ["8315", "EINS"],
      ["8316", "EKG1"],
      ["3000", "4711"],
      ["8420", "120"],
    ]);
    drop("EINSEKG1.001", result);
    const w = start();
    await w.rescanNow();
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(join(gdtDir, "EINSEKG1.001"))).toBe(true);
    expect(w.status().ignoredFiles).toBe(1);
  });
});

describe("GDT watcher: incomplete and broken files", () => {
  it("waits for a fresh file without final CR LF, then accepts it once stable", async () => {
    const p = drop("EINSPVS.001", patient("7").subarray(0, patient("7").length - 2), 0);
    const w = start({ tornGraceMs: 400 });
    await w.rescanNow();
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(p)).toBe(true);
    // An exporter that omits the final CR LF: once WE have seen the file
    // unchanged for the grace period it is accepted instead of blocking the
    // PVS channel forever.
    await sleep(450);
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["7"]);
    expect(existsSync(p)).toBe(false);
  });

  it("accepts a file without final CR LF immediately when FK 8100 proves it complete", async () => {
    // Spec example with the receiver (FK 8315) changed from EKG_TYP1 to EINS:
    // 4 bytes shorter, so FK 8100 declares 169 instead of 173.
    const lines = [
      "01380006301",
      "014810000169",
      "0138315EINS",
      "0178316PRAX_EDV",
      "014921802.10",
      "014300002345",
      "0193101Mustermann",
      "0143102Franz",
      "017310301101945",
      "01031101",
      "0123622178",
      "0123623079",
    ];
    const full = Buffer.from(lines.map((l) => `${l}\r\n`).join(""), "latin1");
    drop("EINSPVS.GDT", full, 0);
    const w = start({ tornGraceMs: 60_000 });
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["02345"]);
  });

  it("moves an addressed file that is not GDT at all to .eins/failed (channel stays free)", async () => {
    drop("EINSPVS.001", Buffer.from("this is not a GDT file\r\n"));
    const w = start({ tornGraceMs: 300 });
    await w.rescanNow();
    // Not quarantined on first sight: it may still be being written.
    expect(existsSync(join(gdtDir, "EINSPVS.001"))).toBe(true);
    await sleep(350);
    await w.rescanNow();
    expect(existsSync(join(gdtDir, "EINSPVS.001"))).toBe(false);
    expect(readdirSync(join(gdtDir, ".eins", "failed"))).toHaveLength(1);
    expect(w.status().quarantinedFiles).toBe(1);
  });
});

describe("GDT watcher: crash recovery", () => {
  it("re-processes a file left in .eins/processing by a crash", async () => {
    mkdirSync(join(gdtDir, ".eins", "processing"), { recursive: true });
    writeFileSync(join(gdtDir, ".eins", "processing", "1700000000000-1-EINSPVS.GDT"), patient("55"));
    const w = start();
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["55"]);
    expect(readdirSync(join(gdtDir, ".eins", "processing"))).toEqual([]);
  });

  it("a replay of an already-enqueued file does not duplicate events", async () => {
    const bytes = patient("66");
    drop("EINSPVS.GDT", bytes);
    const w = start();
    await w.rescanNow();
    mkdirSync(join(gdtDir, ".eins", "processing"), { recursive: true });
    const replay = join(gdtDir, ".eins", "processing", "1-1-EINSPVS.GDT");
    writeFileSync(replay, bytes);
    const t = (Date.now() - 60_000) / 1000;
    utimesSync(replay, t, t);
    // Same bytes but a different mtime would be a different occurredAt; the
    // event id is content-based, so the outbox keeps exactly one row.
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["66"]);
  });
});

describe("GDT watcher: BDT exports are read-only", () => {
  it("translates a BDT export once and never deletes it", async () => {
    const bdt = gdt([
      ["8000", "0020"],
      ["8000", "6100"],
      ["3000", "1"],
      ["3101", "A"],
      ["8000", "6100"],
      ["3000", "2"],
      ["3101", "B"],
    ]);
    drop("export.bdt", bdt);
    const w = start();
    await w.rescanNow();
    await w.rescanNow();
    expect(queuedPatientIds().sort()).toEqual(["1", "2"]);
    expect(existsSync(join(gdtDir, "export.bdt"))).toBe(true);
  });
});


describe("GDT watcher: never recreates a missing watch folder (finding 1)", () => {
  it("leaves a nonexistent folder alone and reports the listing failure", async () => {
    const missing = join(tempDir, "MovedExportDir");
    const w = start({ folder: missing });
    await w.rescanNow();
    expect(existsSync(missing)).toBe(false);
    expect(w.status().consecutiveListingFailures).toBeGreaterThanOrEqual(1);
    expect(w.status().lastError).toMatch(/cannot list GDT folder/);
    await w.rescanNow();
    expect(existsSync(missing)).toBe(false);
    expect(health().status).toBe("error");
  });

  it("creates .eins work folders when the folder exists", async () => {
    const w = start();
    await w.rescanNow();
    expect(existsSync(join(gdtDir, ".eins", "processing"))).toBe(true);
    expect(existsSync(join(gdtDir, ".eins", "failed"))).toBe(true);
  });
});

describe("GDT watcher: half-written files are not claimed (finding 2)", () => {
  it("a file with mtime 60 s in the past but first seen now is not consumed on first sight", async () => {
    drop("EINSPVS.001", patient("1"), 60_000);
    const w = start({ stabilityMs: 5_000 });
    await w.rescanNow();
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(join(gdtDir, "EINSPVS.001"))).toBe(true);
  });

  it("a file cut at a CRLF boundary stays while FK 8100 declares more bytes, until tornGraceMs", async () => {
    const cut = gdt([
      ["8000", "6301"],
      ["8100", "500"],
      ["8315", "EINS"],
      ["3000", "CUT1"],
    ]);
    const p = drop("EINSPVS.001", cut);
    const w = start({ tornGraceMs: 400 });
    await w.rescanNow();
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(p)).toBe(true);
    await sleep(450);
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["CUT1"]);
  });

  it("a 0-byte file is not quarantined before the grace period", async () => {
    const p = drop("EINSPVS.001", Buffer.alloc(0));
    const w = start({ tornGraceMs: 400 });
    await w.rescanNow();
    expect(existsSync(p)).toBe(true);
    expect(readdirSync(join(gdtDir, ".eins", "failed"))).toEqual([]);
    await sleep(450);
    await w.rescanNow();
    expect(existsSync(p)).toBe(false);
    expect(readdirSync(join(gdtDir, ".eins", "failed"))).toHaveLength(1);
  });

  it("aborts the claim when the file changed after it was read (writer still active)", async () => {
    const p = drop("EINSPVS.001", patient("old"));
    let calls = 0;
    const w = start({
      testHooks: {
        beforeClaim: async () => {
          if (++calls > 1) return;
          writeFileSync(p, patient("new"));
          const t = (Date.now() + 5_000) / 1000;
          utimesSync(p, t, t);
        },
      },
    });
    await w.rescanNow();
    await w.rescanNow();
    // Without the re-stat the first pass claims the changed file (one hook
    // call); with it the claim is aborted and the file re-judged (two calls).
    expect(calls).toBe(2);
    expect(queuedPatientIds()).toEqual(["new"]);
    expect(existsSync(p)).toBe(false);
  });
});

describe("GDT watcher: health from structured state (finding 3)", () => {
  it("recovers to ok after a transient folder outage", async () => {
    const w = start();
    await w.rescanNow();
    rmSync(gdtDir, { recursive: true, force: true });
    await w.rescanNow();
    await w.rescanNow();
    expect(health().status).toBe("error");
    mkdirSync(gdtDir);
    await w.rescanNow();
    expect(health().status).toBe("ok");
    expect(w.status().lastError).toBeNull();
    expect(w.status().consecutiveListingFailures).toBe(0);
    // and the folder is usable again
    drop("EINSPVS.GDT", patient("after"));
    await w.rescanNow();
    expect(queuedPatientIds()).toEqual(["after"]);
  });

  it("one claim failure is retrying, not an error", async () => {
    mkdirSync(join(gdtDir, ".eins"), { recursive: true });
    writeFileSync(join(gdtDir, ".eins", "processing"), "blocker"); // mkdir/rename fails
    drop("EINSPVS.001", patient("x"));
    const w = start();
    await w.rescanNow();
    expect(w.status().retryingFiles).toBe(1);
    expect(health().status).not.toBe("error");
  });
});

describe("GDT watcher: name-addressed but FK 8315 names someone else (finding 4)", () => {
  it("surfaces the file as degraded with both ids, and re-evaluates after a receiver change", async () => {
    const p = drop("EINSPVS.GDT", patient("77", "EINS01"));
    const w = start();
    await w.rescanNow();
    expect(existsSync(p)).toBe(true);
    expect(outbox.dueRows(10)).toEqual([]);
    const h = health();
    expect(h.status).toBe("degraded");
    expect(h.lastError).toMatch(/8315/);
    expect(h.lastError).toMatch(/EINS01/);
    await w.stop();
    // The practice fixes the agent's receiver id; the file is unchanged.
    const w2 = start({ receiverId: "EINS01" });
    await w2.rescanNow();
    expect(queuedPatientIds()).toEqual(["77"]);
    expect(existsSync(p)).toBe(false);
  });
});

describe("GDT watcher: addressed file without any event (finding 5)", () => {
  it("moves a 6301 without FK 3000 to .eins/failed and reports degraded", async () => {
    drop(
      "EINSPVS.001",
      gdt([
        ["8000", "6301"],
        ["8315", "EINS"],
        ["3101", "Muster"],
      ])
    );
    const w = start();
    await w.rescanNow();
    expect(existsSync(join(gdtDir, "EINSPVS.001"))).toBe(false);
    expect(readdirSync(join(gdtDir, ".eins", "failed"))).toHaveLength(1);
    expect(w.status()).toMatchObject({ consumedFiles: 0, droppedFiles: 1 });
    expect(health().status).toBe("degraded");
  });
});

describe("GDT watcher: implausible file mtime (finding 6)", () => {
  it("uses the claim time when the mtime is before 2000", async () => {
    const p = drop("EINSPVS.001", patient("old-rtc"));
    const t = Date.UTC(1999, 5, 1) / 1000;
    utimesSync(p, t, t);
    const w = start();
    await w.rescanNow();
    const ev = JSON.parse(outbox.dueRows(10)[0].payload);
    expect(Math.abs(Date.parse(ev.occurredAt) - Date.now())).toBeLessThan(60_000);
  });

  it("uses the claim time when the mtime is more than a day ahead", async () => {
    const p = drop("EINSPVS.001", patient("future-rtc"));
    const t = (Date.now() + 3 * 86_400_000) / 1000;
    utimesSync(p, t, t);
    const w = start();
    await w.rescanNow();
    const ev = JSON.parse(outbox.dueRows(10)[0].payload);
    expect(Math.abs(Date.parse(ev.occurredAt) - Date.now())).toBeLessThan(60_000);
  });
});

describe("GDT watcher: claimed file stuck in processing (finding 10)", () => {
  it("does not count a replay as consumed and degrades after 2 failed attempts", async () => {
    drop("EINSPVS.001", patient("stuck"));
    const w = start({
      testHooks: {
        enqueueMany: () => {
          throw new Error("disk full");
        },
      },
    });
    await w.rescanNow();
    await w.rescanNow();
    const st = w.status();
    expect(st.consumedFiles).toBe(0);
    expect(st.stuckClaimed).toBe(1);
    expect(health().status).not.toBe("ok");
    expect(readdirSync(join(gdtDir, ".eins", "processing"))).toHaveLength(1);
  });
});

describe("GDT watcher: UNC paths and stat storms (finding 11)", () => {
  it("recognises UNC paths", () => {
    expect(watcherMod.isUncPath("\\\\srv\\share\\gdt")).toBe(true);
    expect(watcherMod.isUncPath("//srv/share/gdt")).toBe(true);
    expect(watcherMod.isUncPath("C:\\GDT")).toBe(false);
  });

  it("never has more than 8 stat calls in flight during a rescan", async () => {
    for (let i = 0; i < 2000; i++) {
      writeFileSync(join(gdtDir, `DEV${String(i).padStart(4, "0")}.GDT`), "");
    }
    let inflight = 0;
    let max = 0;
    const w = start({
      testHooks: {
        stat: (async (p: string) => {
          inflight++;
          max = Math.max(max, inflight);
          await new Promise((r) => setImmediate(r));
          try {
            return await realStat(p);
          } finally {
            inflight--;
          }
        }) as unknown as typeof realStat,
      },
    });
    await w.rescanNow();
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(8);
  }, 60_000);
});
