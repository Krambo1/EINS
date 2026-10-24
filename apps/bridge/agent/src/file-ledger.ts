import type Database from "better-sqlite3";
import { outboxConnection } from "./outbox.js";

/**
 * Per-file processing ledger for the folder watchers (GDT inbox, Honorar CSV).
 *
 * Replaces the single per-folder MAX(mtime) cursor (watcher-state.ts) as the
 * source of truth for "has this file been handled". The cursor lost data in
 * three real-world ways:
 *   1. A file that failed once (EBUSY while the PVS or a virus scanner held
 *      it, disk full during enqueue) was stranded as soon as any NEWER file
 *      succeeded and moved the cursor past it. Nothing ever retried it.
 *   2. A file skipped for a fixable reason (unknown CSV header) was never
 *      re-read after the mapping was fixed.
 *   3. Files copied in with an old mtime (robocopy /COPY:T, restore from
 *      backup) were invisible.
 *
 * The ledger keys each file by (watch folder, file name) and remembers the
 * size + mtime + an optional fingerprint (e.g. the CSV mapping in effect) it
 * was handled with. A file is processed again whenever any of those change,
 * and a failed file is retried with exponential backoff. The periodic rescan
 * in each watcher consults the ledger, so a missed chokidar event (SMB share,
 * folder recreated, agent offline) is caught within one rescan interval.
 *
 * Lives on the shared SQLCipher outbox connection (same reasoning as
 * watcher-state.ts: one keyed handle, never a second plaintext driver).
 */

export type LedgerStatus = "done" | "failed" | "ignored";

export type LedgerKind = "gdt" | "csv";

export interface LedgerSummary {
  done: number;
  failed: number;
  ignored: number;
  /** Most recent error text among failed files (file names omitted). */
  lastError: string | null;
  /** Reason of the most recently updated ignored file (its row exists only
   *  while the file is still in the folder, prune removes vanished files).
   *  Survives agent restarts, unlike in-memory watcher state. */
  lastIgnoredReason?: string | null;
}

/** Default kind. The Honorar CSV watcher predates the kind dimension and
 *  passes none; the GDT watcher always passes "gdt" explicitly. */
const DEFAULT_KIND: LedgerKind = "csv";

/** Rows are namespaced `${kind}:${path}` so one folder watched by both a GDT
 *  and a CSV watcher keeps two independent sets of rows (a prune by one
 *  must never delete the other's). */
function key(watchPath: string, kind: LedgerKind | undefined): string {
  return `${kind ?? DEFAULT_KIND}:${watchPath}`;
}

const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 60 * 60_000;

let injectedDb: Database.Database | null = null;
const tableEnsured = new WeakSet<Database.Database>();

function db(): Database.Database {
  const conn = injectedDb ?? outboxConnection();
  if (!tableEnsured.has(conn)) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS file_ledger (
        watch_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        fingerprint TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (watch_path, file_name)
      );
    `);
    // Rows written before the kind namespace existed carry a bare path. They
    // are never read again (their key no longer matches); drop them so they
    // do not linger. Effect: each file is re-read once, which is idempotent.
    conn.exec(
      `DELETE FROM file_ledger WHERE watch_path NOT LIKE 'gdt:%' AND watch_path NOT LIKE 'csv:%'`
    );
    tableEnsured.add(conn);
  }
  return conn;
}

export interface FileIdentity {
  watchPath: string;
  fileName: string;
  size: number;
  mtimeMs: number;
  /** Anything that should force a re-read when it changes (mapping hash). */
  fingerprint?: string;
  /** Which watcher owns the row. Default "csv" (see DEFAULT_KIND). */
  kind?: LedgerKind;
}

interface Row {
  size: number;
  mtime_ms: number;
  fingerprint: string;
  status: LedgerStatus;
  attempts: number;
  next_attempt_at: number;
}

function readRow(id: FileIdentity): Row | undefined {
  return db()
    .prepare(
      `SELECT size, mtime_ms, fingerprint, status, attempts, next_attempt_at
       FROM file_ledger WHERE watch_path = ? AND file_name = ?`
    )
    .get(key(id.watchPath, id.kind), id.fileName) as Row | undefined;
}

function sameVersion(row: Row, id: FileIdentity): boolean {
  return (
    row.size === id.size &&
    row.mtime_ms === Math.trunc(id.mtimeMs) &&
    row.fingerprint === (id.fingerprint ?? "")
  );
}

/**
 * Should the watcher (re)process this file now?
 *   - never seen, or size / mtime / fingerprint changed → yes
 *   - same version, done or ignored → no
 *   - same version, failed → yes once its backoff has elapsed
 */
export function shouldProcessFile(id: FileIdentity, now = Date.now()): boolean {
  const row = readRow(id);
  if (!row || !sameVersion(row, id)) return true;
  if (row.status === "failed") {
    // A next_attempt_at further out than the backoff cap can only come from a
    // clock that was ahead when it was written: treat it as due.
    return now >= row.next_attempt_at || row.next_attempt_at > now + RETRY_CAP_MS;
  }
  return false;
}

function upsert(
  id: FileIdentity,
  status: LedgerStatus,
  attempts: number,
  nextAttemptAt: number,
  lastError: string | null
): void {
  db()
    .prepare(
      `INSERT INTO file_ledger (watch_path, file_name, size, mtime_ms, fingerprint,
                                status, attempts, next_attempt_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(watch_path, file_name) DO UPDATE SET
         size = excluded.size, mtime_ms = excluded.mtime_ms,
         fingerprint = excluded.fingerprint, status = excluded.status,
         attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at,
         last_error = excluded.last_error, updated_at = excluded.updated_at`
    )
    .run(
      key(id.watchPath, id.kind),
      id.fileName,
      id.size,
      Math.trunc(id.mtimeMs),
      id.fingerprint ?? "",
      status,
      attempts,
      nextAttemptAt,
      lastError,
      Date.now()
    );
}

export function recordFileDone(id: FileIdentity): void {
  upsert(id, "done", 0, 0, null);
}

/** Handled deliberately without producing events (not addressed to us,
 *  unknown format, mapping missing). Re-read only when the file or the
 *  fingerprint changes. `reason` is kept for the heartbeat summary. */
export function recordFileIgnored(id: FileIdentity, reason: string): void {
  upsert(id, "ignored", 0, 0, reason.slice(0, 500));
}

/** Failed; retry with exponential backoff (30 s doubling, capped at 1 h).
 *  Attempts reset when the file itself changes. Returns the retry time. */
export function recordFileFailed(
  id: FileIdentity,
  error: string,
  now = Date.now(),
  /** Lower cap than the 1 h default, e.g. for a blocked fixed-name channel. */
  maxDelayMs?: number
): number {
  const row = readRow(id);
  const attempts =
    row && sameVersion(row, id) && row.status === "failed" ? row.attempts + 1 : 1;
  const delay = Math.min(
    Math.min(RETRY_CAP_MS, maxDelayMs ?? RETRY_CAP_MS),
    RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 30)
  );
  const next = now + delay;
  upsert(id, "failed", attempts, next, error.slice(0, 500));
  return next;
}

/** Drop the entry (the file was consumed/deleted by us). */
export function forgetFile(watchPath: string, fileName: string, kind?: LedgerKind): void {
  db()
    .prepare(`DELETE FROM file_ledger WHERE watch_path = ? AND file_name = ?`)
    .run(key(watchPath, kind), fileName);
}

/** Remove entries for files that no longer exist in the folder, so the
 *  ledger stays bounded by the folder size. Only rows of the same kind. */
export function pruneLedger(
  watchPath: string,
  presentNames: Set<string>,
  kind?: LedgerKind
): number {
  const k = key(watchPath, kind);
  const rows = db()
    .prepare(`SELECT file_name FROM file_ledger WHERE watch_path = ?`)
    .all(k) as Array<{ file_name: string }>;
  const del = db().prepare(
    `DELETE FROM file_ledger WHERE watch_path = ? AND file_name = ?`
  );
  let removed = 0;
  for (const r of rows) {
    if (!presentNames.has(r.file_name)) {
      del.run(k, r.file_name);
      removed++;
    }
  }
  return removed;
}

export function ledgerSummary(watchPath: string, kind?: LedgerKind): LedgerSummary {
  const k = key(watchPath, kind);
  const counts = db()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM file_ledger WHERE watch_path = ? GROUP BY status`
    )
    .all(k) as Array<{ status: LedgerStatus; n: number }>;
  const last = db()
    .prepare(
      `SELECT last_error FROM file_ledger
       WHERE watch_path = ? AND status = 'failed'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(k) as { last_error: string | null } | undefined;
  const lastIgnored = db()
    .prepare(
      `SELECT last_error FROM file_ledger
       WHERE watch_path = ? AND status = 'ignored'
       ORDER BY updated_at DESC, rowid DESC LIMIT 1`
    )
    .get(k) as { last_error: string | null } | undefined;
  const summary: LedgerSummary = {
    done: 0,
    failed: 0,
    ignored: 0,
    lastError: null,
    lastIgnoredReason: null,
  };
  for (const c of counts) summary[c.status] = c.n;
  summary.lastError = last?.last_error ?? null;
  summary.lastIgnoredReason = lastIgnored?.last_error ?? null;
  return summary;
}

/** Failed rows with their attempt counts (health decisions, no file names in
 *  the heartbeat). */
export function failedFiles(
  watchPath: string,
  kind?: LedgerKind
): Array<{ fileName: string; attempts: number; lastError: string | null }> {
  return (
    db()
      .prepare(
        `SELECT file_name, attempts, last_error FROM file_ledger
         WHERE watch_path = ? AND status = 'failed' ORDER BY file_name`
      )
      .all(key(watchPath, kind)) as Array<{
      file_name: string;
      attempts: number;
      last_error: string | null;
    }>
  ).map((r) => ({ fileName: r.file_name, attempts: r.attempts, lastError: r.last_error }));
}

/** Ignored rows, optionally only those whose reason starts with `prefix`. */
export function ignoredFiles(
  watchPath: string,
  kind?: LedgerKind,
  prefix = ""
): Array<{ fileName: string; reason: string }> {
  return (
    db()
      .prepare(
        `SELECT file_name, last_error FROM file_ledger
         WHERE watch_path = ? AND status = 'ignored' ORDER BY file_name`
      )
      .all(key(watchPath, kind)) as Array<{ file_name: string; last_error: string | null }>
  )
    .map((r) => ({ fileName: r.file_name, reason: r.last_error ?? "" }))
    .filter((r) => r.reason.startsWith(prefix));
}

/** Test-only: inject a standalone SQLite handle (see watcher-state.ts). */
export function _setLedgerDbForTesting(handle: Database.Database | null): void {
  injectedDb = handle;
}
