import Database from "better-sqlite3";
import { outboxPath } from "./config.js";

/**
 * SQLite-backed retry outbox.
 *
 * Every event the agent emits is first INSERTed here, then a flush loop
 * tries to POST it. Successful POSTs UPDATE status='sent'. Failures
 * (network, 5xx) re-queue with exponential backoff; 4xx (other than
 * 429) marks the row 'failed' permanently.
 *
 * This makes the agent resilient to intermittent connectivity in
 * Praxis-Networks (which historically don't have great uptime).
 */

let dbCached: Database.Database | null = null;

function db(): Database.Database {
  if (!dbCached) {
    dbCached = new Database(outboxPath());
    dbCached.exec(`
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(content_hash)
      );
      CREATE INDEX IF NOT EXISTS outbox_due_idx
        ON outbox (status, next_attempt_at);
    `);
  }
  return dbCached;
}

export interface OutboxRow {
  id: number;
  payload: string;
  contentHash: string;
  attemptCount: number;
}

export function enqueue(payload: string, contentHash: string): void {
  const now = Date.now();
  try {
    db()
      .prepare(
        `INSERT INTO outbox (payload, content_hash, status, next_attempt_at, created_at)
         VALUES (?, ?, 'pending', ?, ?)`
      )
      .run(payload, contentHash, now, now);
  } catch (err) {
    // UNIQUE violation (already enqueued) → swallow.
    if (!String(err).includes("UNIQUE")) throw err;
  }
}

export function dueRows(limit = 50): OutboxRow[] {
  const rows = db()
    .prepare(
      `SELECT id, payload, content_hash, attempt_count
       FROM outbox
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC
       LIMIT ?`
    )
    .all(Date.now(), limit) as Array<{
    id: number;
    payload: string;
    content_hash: string;
    attempt_count: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    payload: r.payload,
    contentHash: r.content_hash,
    attemptCount: r.attempt_count,
  }));
}

export function markSent(id: number): void {
  db().prepare(`UPDATE outbox SET status = 'sent' WHERE id = ?`).run(id);
}

export function markFailedPermanent(id: number, reason: string): void {
  db()
    .prepare(
      `UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?`
    )
    .run(reason, id);
}

export function recordRetry(id: number, reason: string): void {
  const row = db()
    .prepare(`SELECT attempt_count FROM outbox WHERE id = ?`)
    .get(id) as { attempt_count?: number } | undefined;
  const n = (row?.attempt_count ?? 0) + 1;
  // Exponential backoff: 30s, 60s, 2min, 5min, 15min, 1h, capped at 1h.
  const delayMs = Math.min(60 * 60 * 1000, 30_000 * Math.pow(2, n - 1));
  db()
    .prepare(
      `UPDATE outbox SET attempt_count = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`
    )
    .run(n, reason, Date.now() + delayMs, id);
}

export function vacuumOld(daysSent = 7): void {
  const cutoff = Date.now() - daysSent * 24 * 60 * 60 * 1000;
  db()
    .prepare(`DELETE FROM outbox WHERE status = 'sent' AND created_at < ?`)
    .run(cutoff);
}
