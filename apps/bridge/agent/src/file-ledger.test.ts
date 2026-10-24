import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  _setLedgerDbForTesting,
  failedFiles,
  forgetFile,
  ignoredFiles,
  ledgerSummary,
  pruneLedger,
  recordFileDone,
  recordFileFailed,
  recordFileIgnored,
  shouldProcessFile,
  type FileIdentity,
} from "./file-ledger.js";

let handle: Database.Database;

beforeEach(() => {
  handle = new Database(":memory:");
  _setLedgerDbForTesting(handle);
});

afterEach(() => {
  handle.close();
  _setLedgerDbForTesting(null);
});

const base: FileIdentity = {
  watchPath: "C:/Honorar",
  fileName: "export.csv",
  size: 100,
  mtimeMs: 1_700_000_000_000,
};

describe("file-ledger", () => {
  it("processes an unseen file and skips it once done", () => {
    expect(shouldProcessFile(base)).toBe(true);
    recordFileDone(base);
    expect(shouldProcessFile(base)).toBe(false);
  });

  it("re-processes a done file when size, mtime or fingerprint change", () => {
    recordFileDone(base);
    expect(shouldProcessFile({ ...base, size: 101 })).toBe(true);
    expect(shouldProcessFile({ ...base, mtimeMs: base.mtimeMs + 1 })).toBe(true);
    expect(shouldProcessFile({ ...base, fingerprint: "mapping-v2" })).toBe(true);
  });

  it("retries a failed file after backoff, even if newer files succeeded meanwhile", () => {
    const now = 1_000_000;
    const next = recordFileFailed(base, "EBUSY", now);
    expect(next).toBe(now + 30_000);
    recordFileDone({ ...base, fileName: "newer.csv", mtimeMs: base.mtimeMs + 10_000 });
    expect(shouldProcessFile(base, now + 29_999)).toBe(false);
    expect(shouldProcessFile(base, now + 30_000)).toBe(true);
  });

  it("doubles the backoff on repeated failures and caps it at one hour", () => {
    const now = 0;
    expect(recordFileFailed(base, "x", now)).toBe(30_000);
    expect(recordFileFailed(base, "x", now)).toBe(60_000);
    expect(recordFileFailed(base, "x", now)).toBe(120_000);
    for (let i = 0; i < 20; i++) recordFileFailed(base, "x", now);
    expect(recordFileFailed(base, "x", now)).toBe(3_600_000);
  });

  it("ignored files are re-read only when they change", () => {
    recordFileIgnored(base, "no mapping");
    expect(shouldProcessFile(base)).toBe(false);
    expect(shouldProcessFile({ ...base, fingerprint: "fixed-mapping" })).toBe(true);
  });

  it("summarises per folder and prunes vanished files", () => {
    recordFileDone(base);
    recordFileFailed({ ...base, fileName: "b.csv" }, "EBUSY: locked");
    recordFileIgnored({ ...base, fileName: "c.csv" }, "header unknown");
    recordFileDone({ ...base, watchPath: "C:/Other" });
    expect(ledgerSummary("C:/Honorar")).toEqual({
      done: 1,
      failed: 1,
      ignored: 1,
      lastError: "EBUSY: locked",
      lastIgnoredReason: "header unknown",
    });
    expect(pruneLedger("C:/Honorar", new Set(["export.csv"]))).toBe(2);
    expect(ledgerSummary("C:/Honorar").failed).toBe(0);
    forgetFile("C:/Honorar", "export.csv");
    expect(shouldProcessFile(base)).toBe(true);
  });

  it("treats a next_attempt_at far in the future (clock was ahead) as due", () => {
    const fiveYears = 5 * 365 * 24 * 3_600_000;
    const now = Date.now();
    recordFileFailed(base, "EBUSY", now + fiveYears);
    expect(shouldProcessFile(base, now)).toBe(true);
    // A normal backoff is still respected.
    recordFileFailed({ ...base, fileName: "b.csv" }, "EBUSY", now);
    expect(shouldProcessFile({ ...base, fileName: "b.csv" }, now + 1_000)).toBe(false);
  });

  it("caps the backoff at maxDelayMs when given", () => {
    const cap = 5 * 60_000;
    let next = 0;
    for (let i = 0; i < 12; i++) next = recordFileFailed(base, "x", 0, cap);
    expect(next).toBe(cap);
  });

  it("namespaces rows by watcher kind: a GDT prune does not touch CSV rows of the same folder", () => {
    const csv = { ...base, kind: "csv" as const };
    const gdt = { ...base, kind: "gdt" as const, fileName: "EINSPVS.GDT" };
    recordFileDone(csv);
    recordFileIgnored(gdt, "not_addressed");
    expect(pruneLedger("C:/Honorar", new Set(), "gdt")).toBe(1);
    expect(shouldProcessFile(csv)).toBe(false);
    expect(ledgerSummary("C:/Honorar", "csv").done).toBe(1);
    expect(ledgerSummary("C:/Honorar", "gdt").ignored).toBe(0);
    forgetFile("C:/Honorar", "export.csv", "gdt");
    expect(shouldProcessFile(csv)).toBe(false);
  });

  it("ignores legacy un-prefixed rows (one-time harmless reprocess)", () => {
    handle.exec(`CREATE TABLE IF NOT EXISTS file_ledger (
      watch_path TEXT NOT NULL, file_name TEXT NOT NULL, size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL, fingerprint TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (watch_path, file_name))`);
    handle
      .prepare(
        `INSERT INTO file_ledger VALUES (?, ?, ?, ?, '', 'done', 0, 0, NULL, 1)`
      )
      .run("C:/Honorar", "export.csv", base.size, base.mtimeMs);
    expect(shouldProcessFile(base)).toBe(true);
  });

  it("reports the latest ignore reason and failed rows", () => {
    recordFileIgnored({ ...base, fileName: "a.csv" }, "no_mapping: x");
    expect(ledgerSummary("C:/Honorar").lastIgnoredReason).toBe("no_mapping: x");
    expect(ledgerSummary("C:/Other").lastIgnoredReason).toBeNull();
    recordFileFailed({ ...base, fileName: "b.csv" }, "EPERM");
    recordFileFailed({ ...base, fileName: "b.csv" }, "EPERM");
    expect(failedFiles("C:/Honorar")).toEqual([
      { fileName: "b.csv", attempts: 2, lastError: "EPERM" },
    ]);
    expect(ignoredFiles("C:/Honorar")).toEqual([{ fileName: "a.csv", reason: "no_mapping: x" }]);
  });
});
