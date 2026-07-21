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

  it("reports the pending backlog + retrying subset (H10c)", () => {
    // Three pending rows; retry one so it has attempt_count > 0.
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-1");
    outbox.enqueue(JSON.stringify({ a: 2 }), "hash-2");
    outbox.enqueue(JSON.stringify({ a: 3 }), "hash-3");
    const due = outbox.dueRows(10);
    outbox.recordRetry(due[0].id, "http 503"); // stays pending, attempt_count=1

    const snap = outbox.getFailureSummary();
    // failedCount stays 0 during an outage; the pending fields are what make
    // a permanently-retrying outbox visible.
    expect(snap.failedCount).toBe(0);
    expect(snap.pendingCount).toBe(3);
    expect(snap.pendingWithAttemptsCount).toBe(1);
    expect(snap.oldestPendingAt).not.toBeNull();
  });

  it("counts pending rows stuck past the stale threshold (M-A2)", () => {
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-fresh");
    outbox.enqueue(JSON.stringify({ a: 2 }), "hash-stuck");
    const due = outbox.dueRows(10);
    // Back-date one pending row's created_at to 2h ago (past the 1h stale
    // threshold) via a raw write, leaving the other fresh.
    outbox
      .outboxConnection()
      .prepare(`UPDATE outbox SET created_at = ? WHERE id = ?`)
      .run(Date.now() - 2 * 60 * 60 * 1000, due[1].id);

    const snap = outbox.getFailureSummary();
    // Both rows are still pending, but only the back-dated one is "stuck": a
    // permanently-retrying row failedCount would never surface.
    expect(snap.pendingCount).toBe(2);
    expect(snap.stalePendingCount).toBe(1);
    expect(snap.failedCount).toBe(0);
  });
});

describe("backoffWithJitter (M-A5)", () => {
  it("follows the documented base schedule at the mid-jitter point", () => {
    // rand()=0.5 -> factor 1.0 -> the base delay with no spread.
    const mid = () => 0.5;
    expect(outbox.backoffWithJitter(1, mid)).toBe(30_000);
    expect(outbox.backoffWithJitter(2, mid)).toBe(60_000);
    expect(outbox.backoffWithJitter(3, mid)).toBe(120_000);
    expect(outbox.backoffWithJitter(4, mid)).toBe(240_000);
    expect(outbox.backoffWithJitter(5, mid)).toBe(480_000);
  });

  it("caps the base at 1h before jitter", () => {
    const mid = () => 0.5;
    // attempt 8 -> 30s * 2^7 = 3_840_000ms > 1h, so capped at 3_600_000.
    expect(outbox.backoffWithJitter(8, mid)).toBe(3_600_000);
    expect(outbox.backoffWithJitter(20, mid)).toBe(3_600_000);
  });

  it("spreads +/-20% across the rand() range", () => {
    // rand()=0 -> factor 0.8 (lower bound), rand()->1 -> factor ~1.2 (upper).
    expect(outbox.backoffWithJitter(1, () => 0)).toBe(24_000); // 30_000 * 0.8
    // Near the top of [0,1) the rounded delay approaches (but does not exceed)
    // 30_000 * 1.2 = 36_000.
    expect(outbox.backoffWithJitter(1, () => 0.999999)).toBeLessThanOrEqual(36_000);
    expect(outbox.backoffWithJitter(1, () => 0.999999)).toBeGreaterThan(35_900);
  });

  it("stays within [0.8x, 1.2x) of the base for any rand() value", () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.9999]) {
      const d = outbox.backoffWithJitter(3, () => r);
      expect(d).toBeGreaterThanOrEqual(120_000 * 0.8);
      expect(d).toBeLessThan(120_000 * 1.2);
    }
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

describe("vacuumOld (sent-row retention keys off sent time, L2)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function countHash(hash: string): number {
    const row = outbox
      .outboxConnection()
      .prepare(`SELECT COUNT(*) AS n FROM outbox WHERE content_hash = ?`)
      .get(hash) as { n: number };
    return row.n;
  }

  it("stamps sent_at when a row transitions to sent", () => {
    const before = Date.now();
    outbox.enqueue(JSON.stringify({ a: 1 }), "hash-ts");
    const due = outbox.dueRows(1);
    outbox.markSent(due[0].id);

    const row = outbox
      .outboxConnection()
      .prepare(`SELECT sent_at FROM outbox WHERE id = ?`)
      .get(due[0].id) as { sent_at: number | null };
    expect(row.sent_at).not.toBeNull();
    expect(row.sent_at!).toBeGreaterThanOrEqual(before);
  });

  it("keeps a row enqueued long ago but sent recently", () => {
    // This is the L2 regression: the old `created_at < cutoff` predicate would
    // drop the dedup record the moment the row was vacuumed, even though it was
    // only just delivered.
    outbox.enqueue(JSON.stringify({ a: 2 }), "hash-old-enqueue");
    const due = outbox.dueRows(1);
    outbox.markSent(due[0].id); // sent_at = now

    // Back-date created_at to 30 days ago; sent_at stays "now".
    outbox
      .outboxConnection()
      .prepare(`UPDATE outbox SET created_at = ? WHERE id = ?`)
      .run(Date.now() - 30 * DAY_MS, due[0].id);

    outbox.vacuumOld(7);

    // Survives: retention now keys off the recent sent_at, so the dedup record
    // remains to absorb a replay.
    expect(countHash("hash-old-enqueue")).toBe(1);
  });

  it("deletes a row that was sent longer ago than the retention window", () => {
    outbox.enqueue(JSON.stringify({ a: 3 }), "hash-sent-old");
    const due = outbox.dueRows(1);
    outbox.markSent(due[0].id);

    const tenDaysAgo = Date.now() - 10 * DAY_MS;
    outbox
      .outboxConnection()
      .prepare(`UPDATE outbox SET created_at = ?, sent_at = ? WHERE id = ?`)
      .run(tenDaysAgo, tenDaysAgo, due[0].id);

    outbox.vacuumOld(7);

    expect(countHash("hash-sent-old")).toBe(0);
  });

  it("falls back to created_at for a legacy sent row with no sent_at", () => {
    outbox.enqueue(JSON.stringify({ a: 4 }), "hash-legacy");
    const due = outbox.dueRows(1);
    outbox.markSent(due[0].id);

    // Simulate a pre-migration sent row: old created_at, sent_at never set.
    outbox
      .outboxConnection()
      .prepare(`UPDATE outbox SET created_at = ?, sent_at = NULL WHERE id = ?`)
      .run(Date.now() - 10 * DAY_MS, due[0].id);

    outbox.vacuumOld(7);

    expect(countHash("hash-legacy")).toBe(0);
  });

  it("never deletes a pending row regardless of age", () => {
    outbox.enqueue(JSON.stringify({ a: 5 }), "hash-pending");
    const due = outbox.dueRows(1);

    outbox
      .outboxConnection()
      .prepare(`UPDATE outbox SET created_at = ? WHERE id = ?`)
      .run(Date.now() - 365 * DAY_MS, due[0].id);

    outbox.vacuumOld(7);

    expect(countHash("hash-pending")).toBe(1);
  });
});
