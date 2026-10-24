import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";

/**
 * WP-C outbox hardening, against a real encrypted SQLite file:
 *   A8  getFailureSummary stays cheap on a deep queue
 *   A9  dueRows treats a far-future next_attempt_at as due
 *   B1  a corrected DB-adapter invoice is a new outbox row after the first was sent
 *   B2  failed_at (additive migration), prune on COALESCE(failed_at, created_at),
 *       requeueFailed
 *   B3  rows that failed in one flush cycle keep their relative order
 *   B5  getPendingReasons
 */

let tempDir: string;
vi.mock("./config.js", () => ({ outboxPath: () => join(tempDir, "outbox.sqlite") }));

let outbox: typeof import("./outbox");
const KEY = "a".repeat(64);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "eins-outbox-hard-"));
  vi.resetModules();
  outbox = await import("./outbox.js");
  outbox.setOutboxKey(KEY);
});
afterEach(() => {
  outbox._closeForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function raw() {
  return outbox.outboxConnection();
}

describe("A8: getFailureSummary is bounded", () => {
  it("answers in under 100 ms with 500k pending rows", () => {
    const conn = raw();
    conn.exec(`
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 500000)
      INSERT INTO outbox (payload, content_hash, status, attempt_count, last_error, next_attempt_at, created_at)
      SELECT '{"k":' || i || ',"pad":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}', 'h' || i, 'pending',
             CASE WHEN i % 2 = 0 THEN 3 ELSE 0 END,
             CASE WHEN i % 2 = 0 THEN 'http 503' ELSE NULL END,
             ${Date.now()}, ${Date.now() - 2 * 3_600_000} + i
      FROM seq`);
    outbox.getFailureSummary(); // warm the page cache like a running agent
    const t0 = performance.now();
    const snap = outbox.getFailureSummary();
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
    // Counts are capped (a value equal to the cap means "at least").
    expect(snap.pendingCount).toBe(outbox.SUMMARY_COUNT_CAP);
    expect(snap.pendingWithAttemptsCount).toBe(outbox.SUMMARY_COUNT_CAP);
    expect(snap.stalePendingCount).toBeGreaterThan(0);
    expect(snap.oldestPendingAt).not.toBeNull();
  }, 120_000);

  it("still counts exactly on a small queue", () => {
    outbox.enqueue("a", "1");
    outbox.enqueue("b", "2");
    outbox.recordRetry(1, "x");
    const snap = outbox.getFailureSummary();
    expect(snap.pendingCount).toBe(2);
    expect(snap.pendingWithAttemptsCount).toBe(1);
  });
});

describe("A9: wall-clock jumps do not hide rows", () => {
  it("dueRows returns a row whose next_attempt_at is a day in the future", () => {
    outbox.enqueue("p", "far");
    raw().prepare(`UPDATE outbox SET next_attempt_at = ?`).run(Date.now() + DAY);
    expect(outbox.dueRows().map((r) => r.contentHash)).toEqual(["far"]);
  });

  it("a row legitimately backed off (under 2 h) stays hidden", () => {
    outbox.enqueue("p", "soon");
    raw().prepare(`UPDATE outbox SET next_attempt_at = ?`).run(Date.now() + 3_600_000);
    expect(outbox.dueRows()).toEqual([]);
  });

  it("the 1 h backoff cap with +20% jitter is under the 2 h threshold", () => {
    expect(outbox.backoffWithJitter(50, () => 0.999)).toBeLessThan(2 * 3_600_000);
  });
});

describe("B1: a corrected invoice is not swallowed", () => {
  it("same source id, different amount: the second version is a new pending row after the first was sent", async () => {
    const { normalizeRow } = await import("./db-adapters/normalizer.js");
    const { loadVendorConfigFromString } = await import("./db-adapters/vendor-config.js");
    const { readFileSync } = await import("node:fs");
    const vendor = await loadVendorConfigFromString(
      readFileSync(new URL("./db-adapters/configs/medatixx.yaml", import.meta.url), "utf8"),
      "medatixx.yaml"
    );
    const stream = vendor.streams.find((s) => s.kind === "InvoicePaid")!;
    const make = (amount: number) =>
      normalizeRow(
        {
          id: "4711",
          patient_id: "P1",
          termin_id: "T1",
          behandlung_id: null,
          betrag: amount,
          bezahlt_am: new Date("2026-10-05T09:00:00Z"),
          modified_at: new Date("2026-10-06T09:00:00Z"),
        },
        { vendor, stream, clinicId: "11111111-2222-3333-4444-555555555555" }
      ) as { pvsExternalEventId: string };
    const v1 = make(100);
    const v2 = make(150);
    expect(v1.pvsExternalEventId).not.toBe(v2.pvsExternalEventId);

    outbox.enqueue(JSON.stringify(v1), v1.pvsExternalEventId);
    const [first] = outbox.dueRows();
    outbox.markSent(first!.id);
    const res = outbox.enqueueMany([{ payload: JSON.stringify(v2), contentHash: v2.pvsExternalEventId }]);
    expect(res).toEqual({ inserted: 1, duplicates: 0 });
    expect(outbox.dueRows().map((r) => JSON.parse(r.payload).amountCents)).toEqual([15000]);

    // An unchanged re-read (lookback window) still dedups.
    expect(
      outbox.enqueueMany([{ payload: JSON.stringify(v2), contentHash: make(150).pvsExternalEventId }])
    ).toEqual({ inserted: 0, duplicates: 1 });
  });
});

describe("B2: failed_at and requeue", () => {
  it("markFailedPermanent stamps failed_at", () => {
    outbox.enqueue("p", "a");
    const before = Date.now();
    outbox.markFailedPermanent(1, "http 400: invalid_envelope");
    const row = raw().prepare(`SELECT failed_at FROM outbox WHERE id = 1`).get() as {
      failed_at: number | null;
    };
    expect(row.failed_at).toBeGreaterThanOrEqual(before);
  });

  it("a row created 40 days ago and failed now survives pruneFailedOlderThan(30)", () => {
    outbox.enqueue("p", "old");
    raw().prepare(`UPDATE outbox SET created_at = ?`).run(Date.now() - 40 * DAY);
    outbox.markFailedPermanent(1, "http 400: invalid_envelope");
    expect(outbox.pruneFailedOlderThan(30).prunedCount).toBe(0);
    expect(outbox.getFailureSummary().failedCount).toBe(1);
  });

  it("a row that failed 40 days ago is pruned; a legacy failed row (no failed_at) falls back to created_at", () => {
    outbox.enqueue("p", "a");
    outbox.enqueue("p", "b");
    outbox.markFailedPermanent(1, "x");
    outbox.markFailedPermanent(2, "y");
    raw().prepare(`UPDATE outbox SET failed_at = ? WHERE id = 1`).run(Date.now() - 40 * DAY);
    raw().prepare(`UPDATE outbox SET failed_at = NULL, created_at = ? WHERE id = 2`).run(Date.now() - 40 * DAY);
    const s = outbox.pruneFailedOlderThan(30);
    expect(s.prunedCount).toBe(2);
  });

  it("opening a pre-failed_at database adds the column without touching rows", () => {
    outbox._closeForTests();
    const path = join(tempDir, "outbox.sqlite");
    const old = new Database(path);
    old.pragma(`key = "x'${KEY}'"`);
    old.exec(`
      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, UNIQUE(content_hash));
      INSERT INTO outbox (payload, content_hash, status, last_error, next_attempt_at, created_at)
        VALUES ('p', 'h1', 'failed', 'http 400', 1, ${Date.now() - 40 * DAY});`);
    old.close();
    outbox.setOutboxKey(KEY);
    expect(outbox.getFailureSummary().failedCount).toBe(1);
    const cols = (raw().prepare(`PRAGMA table_info(outbox)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("failed_at");
    expect(outbox.requeueFailed()).toBe(1);
  });

  it("requeueFailed moves failed rows back to pending in place, due immediately, attempts reset", () => {
    outbox.enqueue("p1", "a");
    outbox.enqueue("p2", "b");
    outbox.enqueue("p3", "c");
    outbox.recordRetry(1, "http 503");
    outbox.markFailedPermanent(1, 'http 404: {"error":{"code":"clinic_not_found"}}');
    outbox.markFailedPermanent(2, 'http 400: {"error":{"code":"invalid_envelope"}}');
    expect(outbox.requeueFailed({ reason: "clinic_not_found" })).toBe(1);
    expect(outbox.getFailureSummary().failedCount).toBe(1);
    const r = raw().prepare(`SELECT status, attempt_count, failed_at, next_attempt_at FROM outbox WHERE id = 1`).get() as {
      status: string;
      attempt_count: number;
      failed_at: number | null;
      next_attempt_at: number;
    };
    expect(r.status).toBe("pending");
    expect(r.attempt_count).toBe(0);
    expect(r.failed_at).toBeNull();
    expect(outbox.dueRows().map((x) => x.id)).toContain(1);

    expect(outbox.requeueFailed()).toBe(1); // the rest
    expect(outbox.getFailureSummary().failedCount).toBe(0);
    expect(outbox.requeueFailed()).toBe(0);
  });
});

describe("B3: rows failing in one flush cycle keep their order", () => {
  it("with random jitter that would invert them, the retried rows stay in id order", async () => {
    const { createFlushState, runFlushCycle } = await import("./flush.js");
    for (let i = 1; i <= 6; i++) outbox.enqueue(`{"i":${i}}`, `e${i}`);
    const spy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1)
      .mockReturnValue(0.5);
    const state = createFlushState();
    await runFlushCycle(
      {
        dueRows: (limit) => outbox.dueRows(limit).map((r) => ({ id: r.id, payload: r.payload })),
        postEvent: async () => ({ ok: false, retryable: true, reason: "http 503", httpStatus: 503 }),
        markSent: outbox.markSent,
        recordRetry: outbox.recordRetry,
        markFailedPermanent: outbox.markFailedPermanent,
        outageSnapshot: () => ({ pendingCount: 0, pendingWithAttemptsCount: 0, oldestPendingAt: null, failedCount: 0 }),
        now: () => Date.now(),
        logWarn: () => {},
        logError: () => {},
      },
      state
    );
    spy.mockRestore();
    const order = (
      raw().prepare(`SELECT id FROM outbox ORDER BY next_attempt_at ASC, id ASC`).all() as Array<{ id: number }>
    ).map((r) => r.id);
    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("B5: getPendingReasons", () => {
  it("returns the top last_error values among pending rows that already failed once, bounded", () => {
    for (let i = 1; i <= 7; i++) outbox.enqueue("p", `h${i}`);
    outbox.recordRetry(1, "link_not_ready");
    outbox.recordRetry(2, "link_not_ready");
    outbox.recordRetry(3, "http 502");
    outbox.recordRetry(4, "x".repeat(1000));
    // row 5 never failed; row 6 failed permanently, not pending
    outbox.recordRetry(6, "gone");
    outbox.markFailedPermanent(6, "gone");
    const reasons = outbox.getPendingReasons(5);
    expect(reasons[0]).toEqual({ reason: "link_not_ready", count: 2 });
    expect(reasons.map((r) => r.reason)).not.toContain("gone");
    expect(reasons.every((r) => r.reason.length <= 200)).toBe(true);
    expect(reasons.length).toBeLessThanOrEqual(5);
    expect(outbox.getPendingReasons(1)).toHaveLength(1);
  });

  it("is empty when nothing retried", () => {
    outbox.enqueue("p", "h");
    expect(outbox.getPendingReasons()).toEqual([]);
  });
});
