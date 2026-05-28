import type Database from "better-sqlite3";
import { outboxConnection } from "./outbox.js";

/**
 * Per-watch-folder mtime cursor (P1-5).
 *
 * Background:
 *   The chokidar watcher previously ran with `ignoreInitial: false`, which
 *   means every restart of the agent replayed every file in the watch
 *   folder as an `add` event. The outbox dedupes by content_hash so the
 *   replay was safe, but it cost CPU + parse time proportional to the
 *   folder size. On a Praxis workstation with 5,000 archived GDT files,
 *   that was a noticeable startup cost.
 *
 * Approach:
 *   We store the modification time (epoch ms) of the most-recently
 *   processed file PER watch folder in the agent's SQLite. On boot, the
 *   watcher:
 *     1. Sets chokidar's `ignoreInitial: true`.
 *     2. Does one targeted readdir pass, filtering for files whose
 *        mtime is strictly greater than the persisted cursor.
 *     3. Enqueues those files (so we catch anything written while the
 *        agent was offline).
 *     4. Lets chokidar handle everything from that point forward.
 *
 *   Each successful process(path) updates the cursor to MAX(current,
 *   file.mtime). This is monotonic by design: a file whose mtime
 *   decreases (rare; ntfs/ext4 don't normally do this) would be missed,
 *   which is acceptable for the perf-tier optimisation P1-5 represents.
 *
 * Edge cases:
 *   - Files copied in with preserved mtime (robocopy /COPY:T, rsync -a)
 *     whose original mtime predates the cursor will be missed. Operator
 *     workaround: `eins-agent --rescan` (not yet implemented; tracked
 *     as a Phase 2 reconciliation tool).
 *   - Daylight-saving transitions: we use epoch ms so DST is irrelevant.
 *   - Clock skew on the workstation: a backward clock jump after a
 *     processed write would also cause a miss. Real Praxis workstations
 *     run NTP; we accept the risk.
 */

let injectedDb: Database.Database | null = null;
// Tracks which connections have had the watcher_state table created, so we
// run the idempotent DDL once per handle (the injected test handle and the
// shared outbox connection are distinct objects).
const tableEnsured = new WeakSet<Database.Database>();

/**
 * The mtime cursor shares the agent's single SQLCipher-keyed outbox
 * connection (see outbox.ts:outboxConnection). We deliberately do NOT open
 * outboxPath() with our own better-sqlite3 handle: a second, plaintext
 * driver against the encrypted file races the outbox on first boot and
 * defeats P3-4 at-rest encryption. "One file, one fsync budget, one
 * backup" is preserved by sharing the connection, not the path.
 */
function db(): Database.Database {
  const conn = injectedDb ?? outboxConnection();
  if (!tableEnsured.has(conn)) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS watcher_state (
        watch_path TEXT PRIMARY KEY,
        last_processed_mtime_ms INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    tableEnsured.add(conn);
  }
  return conn;
}

/** Read the cursor for `watchPath`. Returns 0 if no row exists yet. */
export function getWatcherCursor(watchPath: string): number {
  const row = db()
    .prepare(
      `SELECT last_processed_mtime_ms FROM watcher_state WHERE watch_path = ?`
    )
    .get(watchPath) as { last_processed_mtime_ms?: number } | undefined;
  return row?.last_processed_mtime_ms ?? 0;
}

/**
 * Move the cursor forward to `mtimeMs`. Only advances; never moves
 * backwards. A no-op if the persisted value is already >= mtimeMs.
 */
export function setWatcherCursor(watchPath: string, mtimeMs: number): void {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO watcher_state (watch_path, last_processed_mtime_ms, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(watch_path) DO UPDATE SET
         last_processed_mtime_ms = MAX(last_processed_mtime_ms, excluded.last_processed_mtime_ms),
         updated_at = excluded.updated_at`
    )
    .run(watchPath, mtimeMs, now);
}

/**
 * Test-only: inject a standalone SQLite handle in place of the shared
 * outbox connection. The watcher-state unit test passes a file-backed
 * better-sqlite3 handle so it can exercise persistence + the restart case
 * without standing up the encrypted outbox + key. Pass null to revert to
 * the shared connection.
 */
export function _setStateDbForTesting(handle: Database.Database | null): void {
  injectedDb = handle;
}
