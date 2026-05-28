import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * P2-2 contract tests: the outbox snapshot + prune helpers must produce
 * the same shape the heartbeat / failure-summary endpoints expect.
 *
 * Why an integration-style test against a real better-sqlite3 file:
 * better-sqlite3 has driver-specific behaviour around GROUP BY ordering
 * and MIN/MAX over partial-index reads. Mocking those behaviours would
 * give us a green test against a fictitious driver; running the real
 * driver against a temp file catches actual regressions.
 *
 * Each test gets a fresh tmpdir so the agent's `outboxPath()` resolves
 * to an empty file we own. We control the resolution by mocking
 * ./config.js's `outboxPath` export.
 */

let tempDir: string;

vi.mock("./config.js", () => {
  // Resolved dynamically by the beforeEach hook so each `it` gets a
  // fresh DB file. The mock factory runs once at import time, so we
  // close over the `tempDir` variable by reading it inside the function.
  return {
    outboxPath: () => join(tempDir, "outbox.sqlite"),
  };
});

let outbox: typeof import("./outbox");

// P3-4: every outbox open requires a SQLCipher master key. The integration
// tests don't care about the encryption itself; they care about the SQL
// behaviour built on top, so we mint a stable per-test key and hand it to
// the module before any read. Using a fixed-length hex string here keeps
// the per-test setup short; the encryption-specific tests live in
// outbox-encryption.test.ts.
const TEST_KEY_HEX = "a".repeat(64);

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "eins-outbox-test-"));
  vi.resetModules();
  outbox = await import("./outbox.js");
  outbox.setOutboxKey(TEST_KEY_HEX);
});

afterEach(() => {
  // Close the cached SQLite handle BEFORE rmSync. On Windows, deleting
  // a file with an open handle errors EPERM.
  outbox._closeForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("getFailureSummary (P2-2)", () => {
  it("returns zero counts when the outbox is empty", () => {
    const snap = outbox.getFailureSummary();
    expect(snap.failedCount).toBe(0);
    expect(snap.oldestFailedAt).toBeNull();
    expect(snap.lastFailureReason).toBeNull();
    expect(snap.recentReasons).toEqual([]);
  });

  it("aggregates failed rows: count, oldest, last reason, grouped reasons", () => {
    // Seed three failed rows with distinct reasons + one pending row
    // that must NOT appear in the snapshot.
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-pending");
    outbox.enqueue(JSON.stringify({ a: 2 }), "hash-1");
    outbox.enqueue(JSON.stringify({ a: 3 }), "hash-2");
    outbox.enqueue(JSON.stringify({ a: 4 }), "hash-3");
    const due = outbox.dueRows(10);
    expect(due.length).toBe(4);
    // 0 stays pending; mark 1..3 failed with different reasons.
    outbox.markFailedPermanent(due[1].id, "bad signature");
    outbox.markFailedPermanent(due[2].id, "bad signature");
    outbox.markFailedPermanent(due[3].id, "invalid envelope");

    const snap = outbox.getFailureSummary();
    expect(snap.failedCount).toBe(3);
    expect(snap.oldestFailedAt).not.toBeNull();
    // Most-recent failure reason (highest row id wins by our ORDER BY id DESC).
    expect(snap.lastFailureReason).toBe("invalid envelope");
    // Grouped — order is by MAX(id) DESC (most recently affected reason first).
    expect(snap.recentReasons).toEqual([
      { reason: "invalid envelope", count: 1 },
      { reason: "bad signature", count: 2 },
    ]);
  });

  it("ignores rows whose status is sent or pending", () => {
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-1");
    outbox.enqueue(JSON.stringify({ a: 2 }), "hash-2");
    const due = outbox.dueRows(10);
    outbox.markSent(due[0].id);
    outbox.markFailedPermanent(due[1].id, "rejected");

    const snap = outbox.getFailureSummary();
    expect(snap.failedCount).toBe(1);
    expect(snap.lastFailureReason).toBe("rejected");
  });
});

describe("pruneFailedOlderThan (P2-2)", () => {
  it("returns a zero-result summary when nothing matches the age cutoff", () => {
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-1");
    const due = outbox.dueRows(1);
    outbox.markFailedPermanent(due[0].id, "fresh");

    // Pruning >365d ago: nothing matches.
    const result = outbox.pruneFailedOlderThan(365);
    expect(result.prunedCount).toBe(0);
    expect(result.prunedOldestAt).toBeNull();
    expect(result.prunedNewestAt).toBeNull();
    expect(result.reasons).toEqual([]);

    // The fresh row is still there.
    expect(outbox.getFailureSummary().failedCount).toBe(1);
  });

  it("removes rows older than the cutoff and reports the roll-up", async () => {
    // Insert one row, then forcibly back-date its created_at via a raw
    // sqlite write. better-sqlite3 exposes the underlying Database via
    // the module's internal cache, but we don't have direct access here —
    // instead, we exploit the prune's behaviour by passing days=0 so
    // ALL failed rows are "older than now". This still exercises the
    // delete + roll-up path against real SQL.
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-1");
    outbox.enqueue(JSON.stringify({ a: 2 }), "hash-2");
    outbox.enqueue(JSON.stringify({ a: 3 }), "hash-3");
    const due = outbox.dueRows(10);
    outbox.markFailedPermanent(due[0].id, "alpha");
    outbox.markFailedPermanent(due[1].id, "alpha");
    outbox.markFailedPermanent(due[2].id, "beta");

    // Wait a millisecond so cutoff (Date.now() - 0 days = Date.now())
    // is strictly later than the row's created_at.
    await new Promise((r) => setTimeout(r, 5));

    const result = outbox.pruneFailedOlderThan(0);
    expect(result.prunedCount).toBe(3);
    expect(result.prunedOldestAt).not.toBeNull();
    expect(result.prunedNewestAt).not.toBeNull();
    // Reasons grouped by count desc.
    expect(result.reasons).toEqual([
      { reason: "alpha", count: 2 },
      { reason: "beta", count: 1 },
    ]);

    // After prune, the outbox no longer has failed rows.
    const after = outbox.getFailureSummary();
    expect(after.failedCount).toBe(0);
  });
});
