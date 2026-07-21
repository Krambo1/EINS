import Database from "better-sqlite3-multiple-ciphers";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { outboxPath } from "./config.js";

/**
 * Retention window for the `<outbox>.legacy-<ts>` plaintext forensic copies
 * the SQLCipher migration leaves behind (pentest M15). After this, on the next
 * clean keyed open, the backup is shredded so pre-P3-4 patient-event rows do
 * not sit unencrypted on disk indefinitely.
 */
const LEGACY_BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
 *
 * P3-4: at-rest encryption via SQLCipher.
 *
 *   • The driver is `better-sqlite3-multiple-ciphers`, an API-compatible
 *     fork of better-sqlite3 with SQLCipher built in. Every callsite in
 *     this module is unchanged from the plaintext driver; only the
 *     import line + the `pragma("key=...")` call differ.
 *   • The encryption key is a 256-bit value held in DPAPI (Windows) /
 *     Keychain (macOS) / 0600 file (Linux), generated once at first
 *     boot. The agent's `index.ts` calls `getOrCreateOutboxKey()` and
 *     hands the hex to `setOutboxKey()` BEFORE any watcher starts, so
 *     the sync `db()` accessor used by the watcher's enqueue path always
 *     has a key available.
 *   • Migration: an agent upgraded from pre-P3-4 has a plaintext
 *     `outbox.sqlite` on disk. The first encrypted open detects this
 *     (the cipher pragma fails to unlock what was never encrypted),
 *     builds a complete encrypted copy at a temp path, copies the legacy
 *     file to `outbox.sqlite.legacy-<ts>` for forensic recovery, then
 *     atomically renames the temp file over the original. The migration
 *     runs once per workstation and is idempotent: until that final
 *     rename `path` still holds the untouched legacy file, so a crash
 *     mid-migration just retries on the next boot (see
 *     `migrateLegacyToEncrypted`).
 */

let dbCached: Database.Database | null = null;
let cachedKeyHex: string | null = null;

/**
 * Initialise the SQLCipher master key for this process. Must be called
 * exactly once at agent startup, BEFORE the first call to `enqueue` /
 * `dueRows` / etc. The agent's `index.ts:main()` does this; tests call
 * it manually before driving the outbox.
 *
 * Calling twice with the same key is a no-op; calling with a different
 * key after the database has been opened throws (a single process has
 * exactly one outbox-DB file open for its full lifetime, and the key
 * cannot be rotated at runtime without re-opening).
 */
export function setOutboxKey(keyHex: string): void {
  if (cachedKeyHex !== null && cachedKeyHex !== keyHex && dbCached !== null) {
    throw new Error(
      "outbox key cannot be changed after the database has been opened"
    );
  }
  cachedKeyHex = keyHex;
}

const SCHEMA_DDL = `
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
`;

/**
 * Apply SCHEMA_DDL plus any additive column migrations. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we probe `PRAGMA table_info` and only ALTER
 * when a column is missing; this is idempotent and safe to run on every open
 * (fresh install, keyed re-open, and the post-migration encrypted file all
 * funnel through here).
 *
 *   • sent_at: epoch-ms a row transitioned to status='sent'. Retention for
 *     sent rows keys off THIS, not created_at: a row enqueued long ago but
 *     delivered recently must keep its dedup record for the full window after
 *     delivery, otherwise a replay right after send loses the
 *     UNIQUE(content_hash) protection. Nullable so pre-migration sent rows
 *     (which never recorded a send time) stay valid; vacuumOld falls back to
 *     created_at for those.
 */
function ensureSchema(conn: Database.Database): void {
  conn.exec(SCHEMA_DDL);
  const cols = conn
    .prepare(`PRAGMA table_info(outbox)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "sent_at")) {
    conn.exec(`ALTER TABLE outbox ADD COLUMN sent_at INTEGER`);
  }
}

function db(): Database.Database {
  if (!dbCached) {
    if (!cachedKeyHex) {
      // Fail loud; silently generating a session key would mean every
      // restart re-encrypts with a different key, orphaning rows.
      throw new Error(
        "outbox key not initialised; call setOutboxKey(hex) before any outbox operation (agent startup is missing the call)"
      );
    }
    dbCached = openWithMigration(outboxPath(), cachedKeyHex);
  }
  return dbCached;
}

/**
 * The agent's ONE SQLCipher-keyed handle to the outbox file.
 *
 * Other modules that persist small amounts of state in the same file
 * (`watcher-state.ts`'s mtime cursor, `db-adapters/framework.ts`'s
 * `db_adapter_state` / `db_adapter_drift`) MUST borrow this connection
 * rather than opening `outboxPath()` with their own `better-sqlite3`
 * handle. Two drivers against one file is broken three ways:
 *   1. A plaintext open RACES the encrypted open for the same path. On a
 *      fresh install the plaintext side wins, creating an unencrypted file
 *      the cipher side then mis-detects as a "legacy plaintext outbox" and
 *      fails to migrate (no `outbox` table); the agent bricks at first
 *      boot.
 *   2. If the encrypted side wins, the plaintext open sees ciphertext and
 *      throws "file is not a database".
 *   3. Either way patient-event rows could land in a plaintext file,
 *      defeating P3-4 at-rest encryption.
 * Sharing this single keyed connection makes the "one file, one fsync
 * budget, one backup" intent actually work. The key is set in
 * `index.ts:main()` before any watcher or db-adapter runner starts, so the
 * connection is always available by the time those callers reach it.
 */
export function outboxConnection(): Database.Database {
  return db();
}

/**
 * Open the outbox file at `path`, applying the SQLCipher key and
 * migrating an unencrypted legacy file if found.
 *
 * The "legacy plaintext" branch only fires on the FIRST P3-4 boot
 * against a workstation that was previously running a pre-P3-4 agent.
 * After the rename, the encrypted file IS the canonical outbox; future
 * opens take the fast path (open + key + schema check).
 */
function openWithMigration(
  path: string,
  keyHex: string
): Database.Database {
  const existedOnDisk = existsSync(path);

  // Open (or create) the file and apply the key. better-sqlite3-multiple-
  // ciphers defers the actual encryption verification until the first
  // page read; so the open itself can't tell us whether the key is right.
  // We probe by issuing a trivial read.
  let conn = new Database(path);
  applyKey(conn, keyHex);

  if (!existedOnDisk) {
    // Fresh install: the file is brand-new; the key write happens with
    // the first schema DDL.
    ensureSchema(conn);
    return conn;
  }

  if (canRead(conn)) {
    // Already encrypted with this key. Ensure schema is current (idempotent
    // CREATE IF NOT EXISTS handles upgrades).
    ensureSchema(conn);
    // The encrypted file has just proven it opens with the key, so any
    // post-migration plaintext backup older than the retention window has
    // served its verify-replay purpose — shred it (pentest M15).
    pruneStaleLegacyBackups(path);
    return conn;
  }

  // The read failed. Two sub-cases:
  //   a) the file is legacy plaintext; open it without the key works.
  //   b) the file is encrypted but with a DIFFERENT key; opening
  //      without the key still throws.
  // Distinguish so we can migrate (a) automatically and bail loud on (b).
  conn.close();

  if (looksLikeLegacyPlaintext(path)) {
    console.warn(
      `[outbox] detected legacy plaintext outbox at ${path}; migrating to SQLCipher`
    );
    return migrateLegacyToEncrypted(path, keyHex);
  }

  throw new Error(
    `outbox at ${path} is encrypted but the stored key does not unlock it; secure-store is out of sync with the file. ` +
      `DO NOT delete the file blindly; it contains queued events. Recovery: restore secure-store from a recent backup, or contact support.`
  );
}

/**
 * Apply the SQLCipher key pragma. The `x'HEX'` form passes raw bytes
 * (skipping SQLCipher's PBKDF2 derivation), which is what we want when
 * the caller already holds 256 bits of entropy; fewer moving parts and
 * one fewer chance for a typo in the KDF round count to silently change
 * the at-rest key.
 */
function applyKey(conn: Database.Database, keyHex: string): void {
  // Single-quoted to satisfy the SQLCipher tokenizer.
  conn.pragma(`key = "x'${keyHex}'"`);
}

/**
 * Cheap probe to confirm the key unlocks the file. Reads sqlite_master,
 * which is the first encrypted page on disk: a wrong key produces
 * "file is not a database" before returning any rows.
 */
function canRead(conn: Database.Database): boolean {
  try {
    conn.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open `path` WITHOUT any key. Returns true iff the file is a readable
 * unencrypted SQLite database; i.e. a pre-P3-4 outbox.sqlite. Returns
 * false if the file is encrypted with an unknown key (the open itself
 * succeeds, but the first read fails the same way as the wrong-key case
 * above; the file header looks identical to a plaintext db so we have to
 * probe with a read).
 */
function looksLikeLegacyPlaintext(path: string): boolean {
  let probe: Database.Database | null = null;
  try {
    probe = new Database(path);
    probe.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    return true;
  } catch {
    return false;
  } finally {
    probe?.close();
  }
}

/**
 * One-shot, crash-safe migration from a plaintext legacy outbox to an
 * encrypted one.
 *
 * We read every row out of the legacy file, build a COMPLETE encrypted copy at
 * a temp path (`<path>.migrating`), fsync it, copy the legacy file to a
 * timestamped forensic backup, and only THEN atomically rename the temp file
 * over the original. The rename is the single commit point: `path` is, at every
 * instant, either the original legacy file or the complete encrypted file,
 * never a half-written one.
 *
 * Crash safety: if the process dies before the final rename, `path` still holds
 * the untouched legacy plaintext, so the next boot re-detects it (the encrypted
 * open fails the same way) and retries the whole migration from scratch. Any
 * leftover `<path>.migrating` from the crashed attempt is removed before the
 * retry rebuilds it, so a partial temp can never be appended to (re-inserting
 * the explicit row ids into a partial leftover would throw a PK collision).
 * This replaces the non-existent "row-count marker" recovery the old comment
 * claimed: there was no marker and no retry; a crash after the legacy rename
 * silently promoted a partial encrypted file.
 *
 * The `.legacy-<ts>` backup is a COPY (not a rename) so the atomic swap can
 * target the original path. It is preserved as the only on-host record of
 * pre-P3-4 ingest so an operator can verify the encrypted file replays — but
 * NOT indefinitely: leaving plaintext patient-event rows on disk defeats the
 * at-rest encryption (pentest M15). `pruneStaleLegacyBackups` shreds it on the
 * next clean keyed open once it is older than LEGACY_BACKUP_RETENTION_MS.
 */
function migrateLegacyToEncrypted(
  path: string,
  keyHex: string
): Database.Database {
  const legacy = new Database(path);
  const rows = legacy
    .prepare(
      `SELECT id, payload, content_hash, status, attempt_count, last_error, next_attempt_at, created_at
         FROM outbox`
    )
    .all() as Array<{
    id: number;
    payload: string;
    content_hash: string;
    status: string;
    attempt_count: number;
    last_error: string | null;
    next_attempt_at: number;
    created_at: number;
  }>;
  legacy.close();

  // Build the encrypted file at a temp path, never at `path`. A crash anywhere
  // before the final rename leaves the legacy file in place for a clean retry.
  // Clear any leftover temp from a previously-crashed attempt first.
  const tmpPath = `${path}.migrating`;
  removeDbFileQuietly(tmpPath);

  const enc = new Database(tmpPath);
  applyKey(enc, keyHex);
  ensureSchema(enc);

  if (rows.length > 0) {
    const insert = enc.prepare(
      `INSERT INTO outbox (id, payload, content_hash, status, attempt_count, last_error, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = enc.transaction((batch: typeof rows) => {
      for (const r of batch) {
        insert.run(
          r.id,
          r.payload,
          r.content_hash,
          r.status,
          r.attempt_count,
          r.last_error,
          r.next_attempt_at,
          r.created_at
        );
      }
    });
    tx(rows);
  }
  // Release the handle (Windows refuses to rename an open file) and force the
  // bytes to disk before the rename becomes visible.
  enc.close();
  fsyncFile(tmpPath);

  // Preserve the legacy plaintext as a forensic copy, then atomically swap the
  // complete encrypted file over the original path.
  const backupPath = `${path}.legacy-${Date.now()}`;
  copyFileSync(path, backupPath);
  renameSync(tmpPath, path);
  // On Linux the file fsync above does not guarantee the rename (the directory
  // entry) survived a power loss; fsync the parent directory to make the swap
  // itself durable. No-op / best-effort on Windows and filesystems that refuse
  // to open a directory for fsync.
  fsyncDir(dirname(path));

  console.warn(
    `[outbox] migration done: ${rows.length} rows copied; legacy file preserved at ${backupPath}. ` +
      `Verify replay then 'rm <legacy-file>' to reclaim space.`
  );

  // Re-open the now-canonical encrypted file; the temp connection is closed.
  const conn = new Database(path);
  applyKey(conn, keyHex);
  return conn;
}

/**
 * Force a file's bytes to durable storage. The SQLite commit already fsyncs the
 * DB pages (synchronous=FULL by default), but the temp file was just closed; we
 * flush the handle once more so a power loss right after the atomic rename
 * cannot surface a renamed-but-empty file.
 */
function fsyncFile(p: string): void {
  const fd = openSync(p, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * fsync a directory so a rename inside it is itself durable (Linux durability
 * nuance: a file fsync flushes the file's data pages but not the parent's
 * directory entry). Best-effort: Windows cannot open a directory as a file
 * descriptor for fsync, and some filesystems refuse it too; in those cases we
 * log and continue, since the file-level fsync already ran and the NTFS
 * metadata-commit semantics make the Linux rename nuance moot.
 */
function fsyncDir(dirPath: string): void {
  if (process.platform === "win32") return;
  let fd: number;
  try {
    fd = openSync(dirPath, "r");
  } catch (err) {
    console.warn(
      `[outbox] could not open ${dirPath} for directory fsync: ${String(err)}`
    );
    return;
  }
  try {
    fsyncSync(fd);
  } catch (err) {
    console.warn(
      `[outbox] directory fsync failed for ${dirPath}: ${String(err)}`
    );
  } finally {
    closeSync(fd);
  }
}

/**
 * Shred `<outbox>.legacy-<ts>` plaintext backups older than the retention
 * window (pentest M15). Runs only on a clean keyed open (the encrypted file
 * has just proven itself), so the freshly-migrated backup is kept for the
 * operator's verify-replay window and only an aged one is removed. Best-effort
 * overwrite-then-unlink: the overwrite is not guaranteed on copy-on-write/SSD
 * media but is strictly better than a bare unlink for a casual disk scrape.
 */
function pruneStaleLegacyBackups(path: string): void {
  const dir = dirname(path);
  const re = new RegExp(`^${escapeRegExp(basename(path))}\\.legacy-(\\d+)$`);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir vanished / unreadable — nothing to prune
  }
  const now = Date.now();
  for (const name of entries) {
    const m = re.exec(name);
    if (!m) continue;
    const ts = Number(m[1]);
    if (!Number.isFinite(ts) || now - ts < LEGACY_BACKUP_RETENTION_MS) continue;
    const full = join(dir, name);
    try {
      const size = statSync(full).size;
      if (size > 0) writeFileSync(full, Buffer.alloc(size, 0));
    } catch {
      // overwrite is best-effort; still try to unlink below
    }
    try {
      unlinkSync(full);
      console.warn(
        `[outbox] shredded stale legacy plaintext backup ${name} ` +
          `(older than ${LEGACY_BACKUP_RETENTION_MS / 86_400_000}d)`
      );
    } catch {
      // non-fatal: a locked/again-missing file just gets retried next boot
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove a SQLite file plus any rollback-journal / WAL siblings, ignoring a
 * missing file. Used to clear a stale `<path>.migrating` left by a crashed
 * migration before rebuilding it.
 */
function removeDbFileQuietly(p: string): void {
  for (const f of [p, `${p}-journal`, `${p}-wal`, `${p}-shm`]) {
    try {
      unlinkSync(f);
    } catch {
      // ENOENT (or any unlink failure) is non-fatal; the rebuild overwrites or
      // fails loudly on its own.
    }
  }
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
  db()
    .prepare(`UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?`)
    .run(Date.now(), id);
}

export function markFailedPermanent(id: number, reason: string): void {
  db()
    .prepare(
      `UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?`
    )
    .run(reason, id);
}

/**
 * Exponential backoff with jitter for a failed outbox row (M-A5).
 *
 * Base schedule by attempt n (1, 2, 3, ...): 30s, 1min, 2min, 4min, 8min,
 * 16min, 32min, then capped at 1h. Each delay is then spread by +/-20% jitter.
 * Without the jitter a whole fleet of agents that lost the portal at the same
 * instant (an outage or a deploy) retries in lock-step and re-synchronises into
 * one thundering herd against the portal's 429 limiter the moment it recovers;
 * the spread de-correlates them. `rand` is injectable so tests can assert the
 * schedule deterministically.
 */
export function backoffWithJitter(
  attempt: number,
  rand: () => number = Math.random
): number {
  const base = Math.min(60 * 60_000, 30_000 * Math.pow(2, attempt - 1));
  // rand() in [0, 1) maps to a factor in [0.8, 1.2): +/-20% jitter.
  const factor = 0.8 + rand() * 0.4;
  return Math.round(base * factor);
}

export function recordRetry(
  id: number,
  reason: string,
  rand: () => number = Math.random
): void {
  const row = db()
    .prepare(`SELECT attempt_count FROM outbox WHERE id = ?`)
    .get(id) as { attempt_count?: number } | undefined;
  const n = (row?.attempt_count ?? 0) + 1;
  const delayMs = backoffWithJitter(n, rand);
  db()
    .prepare(
      `UPDATE outbox SET attempt_count = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`
    )
    .run(n, reason, Date.now() + delayMs, id);
}

/**
 * L20: close the outbox SQLite handle on graceful shutdown. The agent
 * normally holds the connection for its full lifetime; on SIGINT/SIGTERM
 * `index.ts` awaits the in-flight flush and then calls this so the WAL is
 * checkpointed and the file lock released cleanly before the process exits
 * (an abrupt process.exit left the handle open). Idempotent: a second call
 * (or a call after `_closeForTests`) is a no-op. Unlike `_closeForTests` this
 * keeps `cachedKeyHex` so it is safe to call on the real shutdown path.
 */
export function closeOutbox(): void {
  if (dbCached) {
    dbCached.close();
    dbCached = null;
  }
}

/**
 * Test-only: close the cached SQLite handle. Production code never
 * calls this; the agent runs the connection for its full lifetime.
 * Tests that create per-test outbox files need to release the OS lock
 * before deleting the tmp directory on Windows.
 */
export function _closeForTests(): void {
  if (dbCached) {
    dbCached.close();
    dbCached = null;
  }
  cachedKeyHex = null;
}

export function vacuumOld(daysSent = 7): void {
  const cutoff = Date.now() - daysSent * 24 * 60 * 60 * 1000;
  // Retention for sent rows keys off sent_at (when delivery happened), NOT
  // created_at: a row enqueued long ago but sent recently must keep its
  // UNIQUE(content_hash) dedup record for the full window after send, so a
  // replay right after delivery is still absorbed. COALESCE falls back to
  // created_at for pre-migration sent rows whose sent_at was never populated.
  db()
    .prepare(
      `DELETE FROM outbox
         WHERE status = 'sent' AND COALESCE(sent_at, created_at) < ?`
    )
    .run(cutoff);
}

/**
 * M-A2: how old a still-pending row must be before it counts as "stuck". A
 * payload the portal always 500s (or an event blocked behind a link that never
 * confirms) is re-queued hourly forever: it never becomes status='failed', so
 * failedCount-only telemetry stays a healthy 0. `stalePendingCount` counts the
 * pending rows older than this so a permanently-retrying outbox is visible in
 * the heartbeat. One hour comfortably exceeds a normal retry cycle, so a brief
 * portal blip does not register as stuck.
 */
const STALE_PENDING_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * P2-2: aggregate snapshot of the outbox's "things are broken" surface.
 * Posted to the portal as part of the heartbeat so an operator can see
 * `failedEvents` on the admin clinic detail page without SSH-ing into a
 * Praxis-Windows machine. Cheap query; three count/min/max scans over
 * the partial-failed slice of the outbox, all served by the existing
 * `outbox_due_idx` (status, next_attempt_at) index.
 */
export interface FailureSummary {
  failedCount: number;
  oldestFailedAt: number | null;
  lastFailureReason: string | null;
  /**
   * Last 10 distinct failure reasons (most-recent first), each with the
   * row count that hit that reason. Shown in the admin "Show last 10
   * failure reasons" expander. Capped at 10 entries to keep the heartbeat
   * payload bounded; even the worst-case observed Praxis (medatixx
   * adapter mid-rollout) hit at most 3 distinct reasons in 30 days.
   */
  recentReasons: Array<{ reason: string; count: number }>;
  /**
   * H10: the live retry backlog. `failedCount` above only counts rows the
   * agent gave up on (status='failed'); during a multi-day portal outage
   * NOTHING is permanently-failed, so failedCount-only telemetry showed a
   * healthy 0 while thousands of events sat pending. These three surface the
   * pending side so the outage summary log (and heartbeat) can report it.
   */
  /** All rows still status='pending' (waiting to be delivered / retried). */
  pendingCount: number;
  /** Pending rows that already failed at least once (attempt_count > 0). */
  pendingWithAttemptsCount: number;
  /** Oldest created_at among pending rows (epoch-ms), or null. */
  oldestPendingAt: number | null;
  /**
   * M-A2: pending rows older than STALE_PENDING_THRESHOLD_MS. Non-zero means at
   * least one event has been retrying past the point a healthy portal would have
   * accepted it (a payload the portal always 500s, an event stuck behind an
   * unconfirmed link), which failedCount never surfaces because those rows stay
   * 'pending' forever rather than transitioning to 'failed'.
   */
  stalePendingCount: number;
}

export function getFailureSummary(): FailureSummary {
  const counts = db()
    .prepare(
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest
         FROM outbox WHERE status = 'failed'`
    )
    .get() as { n?: number; oldest?: number | null } | undefined;
  const lastRow = db()
    .prepare(
      `SELECT last_error FROM outbox
         WHERE status = 'failed'
         ORDER BY id DESC
         LIMIT 1`
    )
    .get() as { last_error?: string | null } | undefined;
  const grouped = db()
    .prepare(
      `SELECT last_error AS reason, COUNT(*) AS n
         FROM outbox WHERE status = 'failed' AND last_error IS NOT NULL
         GROUP BY last_error
         ORDER BY MAX(id) DESC
         LIMIT 10`
    )
    .all() as Array<{ reason: string | null; n: number }>;
  // H10 / M-A2: pending backlog + the "already retrying" subset + oldest pending
  // age + the count stuck longer than the stale threshold.
  const staleCutoff = Date.now() - STALE_PENDING_THRESHOLD_MS;
  const pending = db()
    .prepare(
      `SELECT
         COUNT(*) AS n,
         SUM(CASE WHEN attempt_count > 0 THEN 1 ELSE 0 END) AS retrying,
         SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) AS stale,
         MIN(created_at) AS oldest
       FROM outbox WHERE status = 'pending'`
    )
    .get(staleCutoff) as
    | {
        n?: number;
        retrying?: number | null;
        stale?: number | null;
        oldest?: number | null;
      }
    | undefined;
  return {
    failedCount: Number(counts?.n ?? 0),
    oldestFailedAt: counts?.oldest ?? null,
    lastFailureReason: lastRow?.last_error ?? null,
    recentReasons: grouped
      .filter((g): g is { reason: string; n: number } => !!g.reason)
      .map((g) => ({ reason: g.reason, count: Number(g.n) })),
    pendingCount: Number(pending?.n ?? 0),
    pendingWithAttemptsCount: Number(pending?.retrying ?? 0),
    oldestPendingAt: pending?.oldest ?? null,
    stalePendingCount: Number(pending?.stale ?? 0),
  };
}

/**
 * P2-2: prune failed rows older than `days` and return a roll-up the
 * caller can POST to the portal so a permanent record survives the
 * prune. Called once per day from the agent's vacuum tick; we ONLY
 * touch `status='failed'` rows so the live retry pipeline is untouched.
 *
 * The roll-up groups by reason because a dead-letter run of 5,000 rows
 * usually has the same root cause repeated 5,000 times; storing each
 * row server-side would bloat the portal without telling the operator
 * anything new.
 */
export interface PruneSummary {
  /** Number of failed rows just deleted. */
  prunedCount: number;
  /** Earliest created_at among the pruned rows; null if none. */
  prunedOldestAt: number | null;
  /** Latest created_at among the pruned rows; null if none. */
  prunedNewestAt: number | null;
  /** Reasons grouped (top 10 by count). */
  reasons: Array<{ reason: string; count: number }>;
}

export function pruneFailedOlderThan(days: number): PruneSummary {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const aggregate = db()
    .prepare(
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest
         FROM outbox WHERE status = 'failed' AND created_at < ?`
    )
    .get(cutoff) as { n?: number; oldest?: number | null; newest?: number | null } | undefined;

  const grouped = db()
    .prepare(
      `SELECT last_error AS reason, COUNT(*) AS n
         FROM outbox WHERE status = 'failed' AND created_at < ?
         GROUP BY last_error
         ORDER BY n DESC
         LIMIT 10`
    )
    .all(cutoff) as Array<{ reason: string | null; n: number }>;

  db()
    .prepare(`DELETE FROM outbox WHERE status = 'failed' AND created_at < ?`)
    .run(cutoff);

  return {
    prunedCount: Number(aggregate?.n ?? 0),
    prunedOldestAt: aggregate?.oldest ?? null,
    prunedNewestAt: aggregate?.newest ?? null,
    reasons: grouped
      .filter((g): g is { reason: string; n: number } => !!g.reason)
      .map((g) => ({ reason: g.reason, count: Number(g.n) })),
  };
}
