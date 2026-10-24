import type Database from "better-sqlite3";
import { enqueueMany, outboxConnection } from "../outbox.js";
import {
  errorMessage,
  extractMissingTable,
  isTableMissingError,
} from "./error-classes.js";
import { normalizeRow, resolveField } from "./normalizer.js";
import { probeSchema, summarizeForReport } from "./schema-probe.js";
import { baseTable, isSafeIdentifierPath } from "./sql-analysis.js";
import {
  FUTURE_CURSOR_TOLERANCE_MS,
  configuredLookbackMs,
  cursorFormatOf,
  describeCursorFormatMismatch,
  domainNowMs,
  formatCursorBind,
  initialHorizonDaysOf,
  nearDstTransition,
  parseCursorValue,
  cursorIsWallClock,
  timezoneOf,
} from "./time-utils.js";
import {
  ALWAYS_REQUIRED,
  REQUIRED_FIELDS_BY_KIND,
} from "./vendor-config.js";
import type {
  CanonicalEventBase,
  CanonicalEventKind,
  CatalogSummary,
  ConfigInvalidFieldIssue,
  ConfigInvalidReport,
  CursorFormat,
  DbDriver,
  DriftReport,
  FieldMapping,
  PendingHealthReport,
  QueryResult,
  StorageTypeSampler,
  StreamConfig,
  StreamState,
  StreamStatus,
  TransformName,
  VendorConfig,
} from "./types.js";

/**
 * SQL-introspection framework.
 *
 * Per-stream loop:
 *   1. Bind :cursor from state, :limit from vendor batchSize.
 *   2. Execute the stream's query.
 *   3. Compare result-set column names against the persisted snapshot.
 *      First poll → write snapshot. Mismatch → mark schema_drift, post a
 *      pvs_link_health hint, halt this stream only. Other streams keep
 *      running.
 *   4. Normalise each row into a CanonicalEvent via the YAML map: block.
 *   5. Enqueue events to the shared agent outbox (UNIQUE on content_hash
 *      makes repeated polls of the same row a no-op).
 *   6. Advance cursor to max(cursorColumn) of the batch. Persist atomically.
 *
 * State lives alongside the outbox in outbox.sqlite (table
 * `db_adapter_state`). Cursors are strings: timestamps in ISO-8601, ints
 * stringified. This keeps the SQL bindings stable across engine types.
 *
 * Failure semantics: any thrown error increments consecutiveFailures and
 * pushes nextRunAt out by exponential backoff (30s, 1min, 2min, 4min, 8min,
 * 16min, 32min, capped at 1h). FAIL_THRESHOLD consecutive failures set status='error' so the
 * portal can surface a health warning at Einstellungen → Integrationen.
 */

const FAIL_THRESHOLD = 5;
const SCHEMA_DRIFT_SOURCE = "db_adapter_framework";

/**
 * Overlap window (review finding H8, reworked). A poll re-binds the timestamp
 * cursor a lookback earlier than the persisted high-water mark so a row that
 * committed LATE below the cursor (a transaction that stamped modified_at at
 * statement time but committed after our last poll, or a backdated data repair)
 * is re-fetched instead of being lost. The lookback is configurable
 * (lookbackMinutes, default 30), never shorter than 2x the poll interval, and
 * stretched to 65 minutes around a DST transition (the fall-back hour repeats on
 * a wall-clock cursor). Re-emitted rows are absorbed by the outbox
 * UNIQUE(content_hash) dedup (the outbox keeps sent ids for 7 days) and the
 * portal dedup index: event ids are deterministic per row version.
 */
const DST_LOOKBACK_MS = 65 * 60_000;

/**
 * Per-(vendor/stream) "the previous poll filled a batch" flag for the overlap
 * window. While a backlog is still draining (previous batch full) the poll uses
 * the STRICT keyset (no lookback): a bulk import of more than batchSize rows
 * inside one lookback window would otherwise re-read its own head forever and
 * the cursor could never page past it. Only when caught up (previous batch not
 * full) is the lookback applied. In-memory on purpose: the persisted cursor is
 * the true high-water mark, so losing this flag on restart is harmless.
 * Cleared by _setStateDbForTesting so tests never inherit a sibling test's
 * drain state.
 */
const lastBatchFull = new Map<string, boolean>();

/** A halted stream (schema_drift / config_invalid) is re-probed this often; if
 *  the query works again it recovers by itself. */
const REPROBE_MS = 30 * 60_000;
/** Consecutive schema-class query errors needed before a stream is halted. A
 *  single odd error (a view being rebuilt, a PVS update window) is retried. */
const SCHEMA_ERROR_THRESHOLD = 3;
/** Largest :limit a strict full batch that cannot advance (a cluster of rows
 *  sharing one truncated cursor value) is retried with. */
const MAX_RAISED_LIMIT = 5000;
/** Pages the lookback overlap read follows before it gives up and logs. */
const OVERLAP_MAX_PAGES = 20;
/** A stream that returned rows before and then none for this long, while a
 *  sibling stream of the same vendor still delivers, is reported suspect_empty. */
const SILENT_STREAM_MS = 7 * 86_400_000;
/** "Sibling still delivers" = it returned rows within this window. */
const SIBLING_ACTIVE_MS = 48 * 3_600_000;
/** Zero-row polls (before the stream ever returned a row) that trigger the
 *  empty-stream diagnostic. */
const EMPTY_POLLS_BEFORE_DIAGNOSTIC = 3;
/** Rows needed before the first-poll validator may halt a stream. */
const MIN_FIRST_POLL_SAMPLE = 10;
/** Polls an inconclusive first-poll sample (< MIN rows, none valid) is held back
 *  before the stream is halted anyway. */
const MAX_DEFERRED_FIRST_POLLS = 20;
/** InvoicePaid amount above this (cents) is flagged: 50,000 EUR. */
const AMOUNT_HIGH_CENTS = 5_000_000;
/** Rows before the median-amount unit check applies. */
const AMOUNT_MEDIAN_MIN_ROWS = 20;
/** A persisted nextRunAt is clamped to now + max(interval, this) on read so a
 *  clock jump forward cannot stall a stream for days. 1 h is the failure-backoff
 *  cap, so a legitimately backed-off stream is not hammered. */
const NEXT_RUN_CLAMP_MS = 60 * 60_000;
/** Deadline for the small diagnostic / catalog queries. */
const DIAGNOSTIC_DEADLINE_MS = 30_000;

/**
 * Rate-limit for the per-row skip log (H6): a systematically bad column must
 * not spam the agent log on every poll. Keyed per vendor/stream. Cleared by
 * _setStateDbForTesting.
 */
const SKIP_LOG_INTERVAL_MS = 60_000;
const lastSkipLogAt = new Map<string, number>();

/**
 * Rate-limit for the post-baseline value-drift log (M-D2). First-poll
 * validation runs ONCE per stream lifetime; a vendor update that later
 * introduces an unmapped status code (or any source value a key transform no
 * longer recognises) makes every emitted event silently drop that field, which
 * the portal worker then discards with no signal on either side. We watch for
 * it on every normal poll and warn, but cap the warning to once per interval per
 * stream so a systematically-unmapped column does not spam the log. Keyed per
 * vendor/stream. Cleared by _setStateDbForTesting.
 */
const VALUE_DRIFT_LOG_INTERVAL_MS = 60_000;
const lastValueDriftLogAt = new Map<string, number>();

/**
 * Engine-agnostic wall-clock deadline for a single driver.query() call
 * (reliability review C4). Firebird, and any engine whose client library
 * has no native timeout, can otherwise hang a poll forever on a DB lock or
 * a half-dead TCP connection, and because the runner awaits polls
 * sequentially, one hung query silently stops polling for EVERY vendor.
 * 150s sits above the 120s native timeouts (pg, mssql, oracledb
 * callTimeout) so those fire first with their better error messages; the
 * race is the backstop for engines without one.
 */
const QUERY_DEADLINE_MS = 150_000;

/**
 * Catch-up delay (review finding L13). When a poll fills its batch (the LIMIT
 * was hit), a backlog is still draining, so the next run is scheduled after
 * this short fixed delay instead of the full poll interval. Without it a
 * 100k-row backfill would advance only one batch per interval (~3.4h per
 * stream at a 60s interval). A short delay lets the runner's next tick pick the
 * stream straight back up; normal cadence resumes once a poll returns a short
 * batch (caught up). Failure/backoff paths are unaffected (recordFailure sets
 * its own nextRunAt).
 */
const CATCHUP_DELAY_MS = 1_000;

/** Error class for deadline expiry so callers can distinguish "the query is
 *  wedged" (connection must be discarded) from an ordinary query error. */
export class DeadlineExceededError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded the ${ms}ms deadline`);
    this.name = "DeadlineExceededError";
  }
}

/**
 * Race a promise against a wall-clock deadline. On expiry the promise is NOT
 * cancelled (JS cannot cancel an in-flight driver call); the caller must
 * treat the underlying connection as wedged and discard it.
 */
export async function withDeadline<T>(
  label: string,
  ms: number,
  fn: () => Promise<T>
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(label, ms)), ms);
  });
  try {
    return await Promise.race([fn(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

let dbCached: Database.Database | null = null;

function db(): Database.Database {
  if (!dbCached) {
    // Borrow the outbox's single SQLCipher-keyed connection; never open
    // outboxPath() with our own (plaintext) better-sqlite3 handle. See the
    // outboxConnection() doc comment for why two drivers on one file is
    // broken (first-boot brick + at-rest-encryption defeat).
    dbCached = outboxConnection();
    dbCached.exec(`
      CREATE TABLE IF NOT EXISTS db_adapter_state (
        vendor_id TEXT NOT NULL,
        stream_kind TEXT NOT NULL,
        cursor TEXT NOT NULL DEFAULT '',
        cursor_tiebreak TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        last_run_at INTEGER,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_run_at INTEGER NOT NULL DEFAULT 0,
        column_snapshot TEXT,
        PRIMARY KEY (vendor_id, stream_kind)
      );
      CREATE TABLE IF NOT EXISTS db_adapter_drift (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id TEXT NOT NULL,
        stream_kind TEXT NOT NULL,
        expected TEXT NOT NULL,
        observed TEXT NOT NULL,
        missing TEXT NOT NULL,
        added TEXT NOT NULL,
        detected_at INTEGER NOT NULL,
        reported_to_portal INTEGER NOT NULL DEFAULT 0,
        -- Phase 5: the same queue carries first-poll config-invalid reports.
        -- 'schema_drift' (default) keeps existing rows + recordDrift inserts
        -- unchanged; 'config_invalid' rows carry their specifics in detail.
        report_kind TEXT NOT NULL DEFAULT 'schema_drift',
        detail TEXT
      );
    `);
    // Migrate agents whose db_adapter_state predates the keyset cursor (review
    // finding 6). The CREATE above already has the column on fresh installs;
    // this ALTER adds it to an existing table. It throws "duplicate column" on
    // every boot after the first, which we swallow; there is no IF NOT EXISTS
    // for ADD COLUMN in SQLite.
    try {
      dbCached.exec(
        `ALTER TABLE db_adapter_state ADD COLUMN cursor_tiebreak TEXT NOT NULL DEFAULT ''`
      );
    } catch {
      // column already present; nothing to do.
    }
    // Phase 5: widen db_adapter_drift on agents that predate config_invalid
    // reports. Same "ALTER throws duplicate-column after the first boot, which
    // we swallow" pattern as cursor_tiebreak above.
    try {
      dbCached.exec(
        `ALTER TABLE db_adapter_drift ADD COLUMN report_kind TEXT NOT NULL DEFAULT 'schema_drift'`
      );
    } catch {
      // column already present; nothing to do.
    }
    try {
      dbCached.exec(`ALTER TABLE db_adapter_drift ADD COLUMN detail TEXT`);
    } catch {
      // column already present; nothing to do.
    }
  }
  return dbCached;
}

/** Test-only hook: swap the SQLite backend for an in-memory copy. */
export function _setStateDbForTesting(handle: Database.Database | null): void {
  dbCached = handle;
  // Reset the in-memory per-stream drain + skip-log state so a test never
  // inherits a sibling test's overlap/log-rate-limit state (both maps are
  // module-level and otherwise persist across the suite).
  lastBatchFull.clear();
  lastSkipLogAt.clear();
  lastValueDriftLogAt.clear();
  memoryNextRun.clear();
  generations.clear();
}

// ---------- reload generation guard --------------------------------------

/**
 * Per-vendor generation counter. runner.reloadVendor() bumps it BEFORE it
 * rewrites the vendor's stream state. A pollOnce that loaded its state under an
 * older generation (it was awaiting the PVS database while the reload happened)
 * must not write its stale snapshot back over the reloaded state: that would
 * restore the old columnSnapshot / halted status the reload just cleared.
 */
const generations = new Map<string, number>();
const stateGeneration = new WeakMap<StreamState, number>();

export function bumpGeneration(vendorId: string): number {
  const next = (generations.get(vendorId) ?? 0) + 1;
  generations.set(vendorId, next);
  return next;
}

function trackGeneration(state: StreamState): void {
  stateGeneration.set(state, generations.get(state.vendorId) ?? 0);
}

function isStale(state: StreamState): boolean {
  const g = stateGeneration.get(state);
  return g !== undefined && g !== (generations.get(state.vendorId) ?? 0);
}

/** saveState, unless the vendor was reloaded since `state` was loaded. */
function commitState(state: StreamState): boolean {
  if (isStale(state)) {
    console.warn(
      `[db-framework] ${state.vendorId}/${state.streamKind}: dropped a stale state write (the vendor config was reloaded while this poll was running)`
    );
    return false;
  }
  saveState(state);
  return true;
}

/** nextRunAt held in memory when persisting state itself fails (disk full,
 *  locked outbox), so a broken state store backs off instead of hot-looping. */
const memoryNextRun = new Map<string, number>();

// ---------- per-stream auxiliary state -----------------------------------

/**
 * State that does not fit db_adapter_state's fixed columns, kept in its own
 * table so databases (and test fixtures) that predate it keep working: the
 * table is created lazily on whichever handle is in use.
 */
export interface StreamAux {
  /** Consecutive schema-class query errors (halt at SCHEMA_ERROR_THRESHOLD). */
  schemaErrors: number;
  /** Zero-row polls before the stream ever returned a row. */
  emptyPolls: number;
  everReturnedRows: boolean;
  diagnosed: boolean;
  suspect: { table: string; rowCount: number; statusValues: string[] } | null;
  /** Inconclusive (too small, nothing valid) first polls held back so far. */
  deferredPolls: number;
  /** Rows beyond now+10min seen on the last poll that returned any. */
  futureRows: number;
  /** [eventId, amountCents] of recent InvoicePaid events, newest last. */
  amounts: Array<[string, number]>;
  /** Event ids of InvoicePaid amounts above 50,000 EUR (sticky until reload). */
  highAmountIds: string[];
  /** Plausibility / data warnings surfaced via lastError. */
  warnings: string[];
  /** Epoch ms of the last poll that returned at least one row (finding 6). */
  lastRowAt: number | null;
  /** Cumulative rows skipped without an event (unmappable / normalize error). */
  skippedRows: number;
  /** Category of the most recent skip: "missing_required_field" |
   *  "normalize_error". Never a cell value. */
  lastSkipReason: string | null;
}

function emptyAux(): StreamAux {
  return {
    schemaErrors: 0,
    emptyPolls: 0,
    everReturnedRows: false,
    diagnosed: false,
    suspect: null,
    deferredPolls: 0,
    futureRows: 0,
    amounts: [],
    highAmountIds: [],
    warnings: [],
    lastRowAt: null,
    skippedRows: 0,
    lastSkipReason: null,
  };
}

const auxReady = new WeakSet<object>();

function auxDb(): Database.Database {
  const h = db();
  if (!auxReady.has(h)) {
    h.exec(`
      CREATE TABLE IF NOT EXISTS db_adapter_aux (
        vendor_id TEXT NOT NULL,
        stream_kind TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (vendor_id, stream_kind)
      );
    `);
    auxReady.add(h);
  }
  return h;
}

function readAuxRaw(vendorId: string, kind: string): Record<string, unknown> | null {
  try {
    const row = auxDb()
      .prepare(`SELECT data FROM db_adapter_aux WHERE vendor_id = ? AND stream_kind = ?`)
      .get(vendorId, kind) as { data: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.data) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeAuxRaw(vendorId: string, kind: string, data: unknown): void {
  try {
    auxDb()
      .prepare(
        `INSERT INTO db_adapter_aux (vendor_id, stream_kind, data) VALUES (?, ?, ?)
         ON CONFLICT(vendor_id, stream_kind) DO UPDATE SET data = excluded.data`
      )
      .run(vendorId, kind, JSON.stringify(data));
  } catch (err) {
    // Aux state is advisory; a failed write must never fail a poll.
    console.warn(
      `[db-framework] ${vendorId}/${kind}: could not persist auxiliary state: ${(err as Error).message}`
    );
  }
}

export function loadAux(vendorId: string, kind: CanonicalEventKind): StreamAux {
  return { ...emptyAux(), ...(readAuxRaw(vendorId, kind) ?? {}) } as StreamAux;
}

function saveAux(vendorId: string, kind: CanonicalEventKind, aux: StreamAux): void {
  writeAuxRaw(vendorId, kind, aux);
}

/** Forget a stream's auxiliary state (a new config deserves a fresh diagnosis). */
export function resetStreamAux(vendorId: string, kind: CanonicalEventKind): void {
  saveAux(vendorId, kind, emptyAux());
}

/** Vendor-level durable flags (the runner's auth-failed latch). */
export interface VendorAux {
  /** sha256 of the credential the DB rejected; retries stop until it changes. */
  authFailedFingerprint: string | null;
  authFailedMessage: string | null;
  /** Ambiguous (SQL Server) login failure only: epoch ms of the single retry
   *  that is allowed despite the latch (never more often than every 6 h). null
   *  = hard latch, cleared only by a credential change. */
  authRetryAt?: number | null;
}

export function loadVendorAux(vendorId: string): VendorAux {
  const raw = readAuxRaw(vendorId, "__vendor__") ?? {};
  return {
    authFailedFingerprint:
      typeof raw.authFailedFingerprint === "string" ? raw.authFailedFingerprint : null,
    authFailedMessage:
      typeof raw.authFailedMessage === "string" ? raw.authFailedMessage : null,
    authRetryAt: typeof raw.authRetryAt === "number" ? raw.authRetryAt : null,
  };
}

export function saveVendorAux(vendorId: string, aux: VendorAux): void {
  writeAuxRaw(vendorId, "__vendor__", aux);
}

export function loadState(
  vendorId: string,
  streamKind: CanonicalEventKind
): StreamState {
  const row = db()
    .prepare(
      `SELECT vendor_id, stream_kind, cursor, cursor_tiebreak, status, last_run_at,
              last_error, consecutive_failures, next_run_at, column_snapshot
       FROM db_adapter_state
       WHERE vendor_id = ? AND stream_kind = ?`
    )
    .get(vendorId, streamKind) as
    | {
        vendor_id: string;
        stream_kind: string;
        cursor: string;
        cursor_tiebreak: string;
        status: string;
        last_run_at: number | null;
        last_error: string | null;
        consecutive_failures: number;
        next_run_at: number;
        column_snapshot: string | null;
      }
    | undefined;
  if (!row) {
    return {
      vendorId,
      streamKind,
      cursor: "",
      cursorTiebreak: "",
      status: "idle",
      lastRunAt: null,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt: 0,
      columnSnapshot: null,
    };
  }
  return {
    vendorId: row.vendor_id,
    streamKind: row.stream_kind as CanonicalEventKind,
    cursor: row.cursor,
    cursorTiebreak: row.cursor_tiebreak ?? "",
    status: row.status as StreamStatus,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    nextRunAt: row.next_run_at,
    columnSnapshot: parseSnapshot(row.column_snapshot, vendorId, streamKind),
  };
}

/** A corrupt snapshot (torn write, manual edit) must not make every poll throw
 *  forever: treat it as "no snapshot", so the next successful poll re-baselines. */
function parseSnapshot(
  raw: string | null,
  vendorId: string,
  streamKind: string
): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  } catch {
    // fall through
  }
  console.warn(
    `[db-framework] ${vendorId}/${streamKind}: column snapshot is corrupt; it will be re-captured on the next poll`
  );
  return null;
}

export function saveState(state: StreamState): void {
  db()
    .prepare(
      `INSERT INTO db_adapter_state
         (vendor_id, stream_kind, cursor, cursor_tiebreak, status, last_run_at,
          last_error, consecutive_failures, next_run_at, column_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vendor_id, stream_kind) DO UPDATE SET
         cursor = excluded.cursor,
         cursor_tiebreak = excluded.cursor_tiebreak,
         status = excluded.status,
         last_run_at = excluded.last_run_at,
         last_error = excluded.last_error,
         consecutive_failures = excluded.consecutive_failures,
         next_run_at = excluded.next_run_at,
         column_snapshot = excluded.column_snapshot`
    )
    .run(
      state.vendorId,
      state.streamKind,
      state.cursor,
      state.cursorTiebreak,
      state.status,
      state.lastRunAt,
      state.lastError,
      state.consecutiveFailures,
      state.nextRunAt,
      state.columnSnapshot ? JSON.stringify(state.columnSnapshot) : null
    );
}

export function recordDrift(report: DriftReport): void {
  db()
    .prepare(
      `INSERT INTO db_adapter_drift
        (vendor_id, stream_kind, expected, observed, missing, added, detected_at, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      report.vendorId,
      report.streamKind,
      JSON.stringify(report.expectedColumns),
      JSON.stringify(report.observedColumns),
      JSON.stringify(report.missing),
      JSON.stringify(report.added),
      new Date(report.detectedAt).getTime(),
      report.catalog ? JSON.stringify({ catalog: report.catalog }) : null
    );
}

/**
 * Persist a first-poll config-invalid report (Phase 5) onto the same queue
 * drift-publisher.ts drains. The legacy columns are kept populated so a reader
 * that only knows the original shape still gets the failing field names in
 * `missing`; the full specifics (sample values, per-field reason, pass count)
 * live in the JSON `detail` column.
 */
export function recordConfigInvalid(report: ConfigInvalidReport): void {
  db()
    .prepare(
      `INSERT INTO db_adapter_drift
        (vendor_id, stream_kind, expected, observed, missing, added,
         detected_at, report_kind, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'config_invalid', ?)`
    )
    .run(
      report.vendorId,
      report.streamKind,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(report.issues.map((i) => i.field)),
      JSON.stringify([]),
      new Date(report.detectedAt).getTime(),
      JSON.stringify({
        sampleSize: report.sampleSize,
        passingRows: report.passingRows,
        threshold: report.threshold,
        issues: report.issues,
      })
    );
}

export function pendingDriftReports(): PendingHealthReport[] {
  const rows = db()
    .prepare(
      `SELECT id, vendor_id, stream_kind, expected, observed, missing, added,
              detected_at, report_kind, detail
       FROM db_adapter_drift
       WHERE reported_to_portal = 0
       ORDER BY detected_at ASC`
    )
    .all() as Array<{
    id: number;
    vendor_id: string;
    stream_kind: string;
    expected: string;
    observed: string;
    missing: string;
    added: string;
    detected_at: number;
    report_kind: string | null;
    detail: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    streamKind: r.stream_kind as CanonicalEventKind,
    expectedColumns: JSON.parse(r.expected) as string[],
    observedColumns: JSON.parse(r.observed) as string[],
    missing: JSON.parse(r.missing) as string[],
    added: JSON.parse(r.added) as string[],
    detectedAt: new Date(r.detected_at).toISOString(),
    // Null report_kind only happens on rows written before the column existed;
    // those are always schema drift.
    reportKind:
      r.report_kind === "config_invalid" ? "config_invalid" : "schema_drift",
    configInvalidDetail:
      r.report_kind === "config_invalid" && r.detail
        ? (JSON.parse(r.detail) as PendingHealthReport["configInvalidDetail"])
        : null,
    catalog:
      r.report_kind !== "config_invalid" && r.detail
        ? (parseCatalog(r.detail) ?? undefined)
        : undefined,
  }));
}

function parseCatalog(detail: string): CatalogSummary | null {
  try {
    const parsed = JSON.parse(detail) as { catalog?: CatalogSummary };
    return parsed.catalog ?? null;
  } catch {
    return null;
  }
}

export function markDriftReported(id: number): void {
  db()
    .prepare(`UPDATE db_adapter_drift SET reported_to_portal = 1 WHERE id = ?`)
    .run(id);
}

// ---------- per-stream poll ----------------------------------------------

export interface PollOutcome {
  emitted: number;
  newCursor: string;
  driftDetected: boolean;
  driftReport: DriftReport | null;
  /** Rows the poll SKIPPED without emitting: a row that failed normalization
   *  (an Invalid Date that escaped the transform guards) or whose required
   *  envelope field did not resolve (H6). Surfaced so the runner can log it;
   *  absent on early-return paths (treated as 0). */
  skippedRows?: number;
  /** Emitted events that dropped a key-transform field because its source value
   *  was present but unrecognised (M-D2 post-baseline value drift). The event
   *  still shipped, but the portal worker will silently discard the missing
   *  field; surfaced so a vendor value-set change is visible. Absent on
   *  early-return paths (treated as 0). */
  unmappedValues?: number;
  /** Rows whose cursor value lay more than 10 minutes in the future. They were
   *  emitted, but did not move the cursor beyond now+10min. */
  futureRows?: number;
  /** A halted stream's re-probe succeeded and the stream is running again. */
  recovered?: boolean;
}

export interface PollOptions {
  clinicId: string;
  vendor: VendorConfig;
  stream: StreamConfig;
  driver: DbDriver;
  /** Optional sink for emitted events. Defaults to outbox.enqueue. */
  sink?: (event: CanonicalEventBase) => void;
  /** Override `now` for deterministic tests. */
  now?: () => number;
}

/** Terminal-until-re-probed statuses. `disabled` is a true terminal. */
const HALT_STATUSES: ReadonlySet<StreamStatus> = new Set([
  "schema_drift",
  "config_invalid",
]);

function haltedNoop(state: StreamState): PollOutcome {
  return {
    emitted: 0,
    newCursor: state.cursor,
    driftDetected: state.status === "schema_drift",
    driftReport: null,
  };
}

/** Largest delay a persisted nextRunAt may legitimately carry. */
function maxNextRunDelay(vendor: VendorConfig, stream: StreamConfig): number {
  return Math.max(intervalMs(vendor, stream), NEXT_RUN_CLAMP_MS);
}

/**
 * nextRunAt as persisted, clamped so a clock jump cannot strand the stream.
 * nextRunAt is a wall-clock value: if the PC clock was ahead when it was written
 * (or jumps), it can sit days in the future. A genuine value never exceeds
 * lastRunAt + the largest legitimate delay, so cap it there; when lastRunAt
 * itself is in the future (the clock went BACKWARDS) cap relative to now.
 */
export function effectiveNextRunAt(
  state: StreamState,
  maxDelayMs: number,
  nowMs: number
): number {
  const base =
    state.lastRunAt !== null && state.lastRunAt <= nowMs ? state.lastRunAt : nowMs;
  return Math.min(state.nextRunAt, base + maxDelayMs);
}

/**
 * Should the runner poll this stream now? Folds in the nextRunAt clamp, the
 * in-memory backoff for a broken state store, and the 30-minute re-probe of
 * halted (schema_drift / config_invalid) streams. disabled and auth_failed
 * streams are never due (the runner clears auth_failed when the credential
 * changes).
 */
export function isStreamDue(
  vendor: VendorConfig,
  stream: StreamConfig,
  state: StreamState,
  nowMs: number
): boolean {
  if (state.status === "disabled" || state.status === "auth_failed") return false;
  const mem = memoryNextRun.get(`${vendor.vendor}/${stream.kind}`);
  if (mem !== undefined && mem > nowMs) return false;
  const maxDelay = HALT_STATUSES.has(state.status)
    ? REPROBE_MS
    : maxNextRunDelay(vendor, stream);
  return effectiveNextRunAt(state, maxDelay, nowMs) <= nowMs;
}

export async function pollOnce(opts: PollOptions): Promise<PollOutcome> {
  const now = opts.now ?? Date.now;
  let state: StreamState;
  try {
    state = loadState(opts.vendor.vendor, opts.stream.kind);
  } catch (err) {
    // The state store itself is unreadable: back off in memory.
    const key = `${opts.vendor.vendor}/${opts.stream.kind}`;
    memoryNextRun.set(key, now() + backoffMs(1));
    console.error(
      `[db-framework] ${key}: could not load stream state: ${errorMessage(err)}`
    );
    return { emitted: 0, newCursor: "", driftDetected: false, driftReport: null };
  }
  trackGeneration(state);
  try {
    return await pollInner(state, opts, now);
  } catch (err) {
    // Anything that escaped pollInner's own handling (saveState on a full disk,
    // a driver that throws synchronously, a bug): record it with backoff instead
    // of letting the runner re-run the stream on every 5 s tick.
    return recordFailureSafe(state, opts, `poll failed: ${errorMessage(err)}`, now);
  }
}

async function pollInner(
  state: StreamState,
  opts: PollOptions,
  now: () => number
): Promise<PollOutcome> {
  const { vendor, stream } = opts;
  const streamKey = `${vendor.vendor}/${stream.kind}`;
  const nowMs = now();

  if (state.status === "disabled" || state.status === "auth_failed") {
    // disabled needs an operator re-enable; auth_failed is cleared by the
    // runner once the credential changes. Never poll meanwhile.
    return haltedNoop(state);
  }

  // A halted stream is not polled until its re-probe is due; then it runs a
  // normal poll in "reprobe" mode: it recovers if the query works again and
  // otherwise stays halted without filing another report.
  let reprobe = false;
  if (HALT_STATUSES.has(state.status)) {
    if (effectiveNextRunAt(state, REPROBE_MS, nowMs) > nowMs) return haltedNoop(state);
    reprobe = true;
  }

  const fmt = cursorFormatOf(vendor, stream);
  const tz = timezoneOf(vendor, stream);
  const isTs = stream.cursorType === "timestamp";
  const aux = loadAux(vendor.vendor, stream.kind);
  const domainNow = domainNowMs(nowMs, fmt, tz);
  const clampMs = domainNow + FUTURE_CURSOR_TOLERANCE_MS;

  // Self-heal a cursor that an earlier version (or a bad PC clock) pushed into
  // the future: every real row would otherwise stay below it forever.
  if (isTs && state.cursor !== "") {
    const stored = parseCursorValue(state.cursor, "native");
    if (stored === null) {
      console.warn(
        `[db-framework] ${streamKey}: stored cursor '${state.cursor}' is not a timestamp; restarting from the initial horizon`
      );
      state.cursor = "";
      state.cursorTiebreak = "";
    } else if (stored > clampMs) {
      console.warn(
        `[db-framework] ${streamKey}: stored cursor ${state.cursor} is more than 10 minutes in the future; clamping it to now`
      );
      state.cursor = new Date(clampMs).toISOString();
      state.cursorTiebreak = "";
    }
  }

  // ---- bind parameters ---------------------------------------------------
  // Overlap window: when CAUGHT UP (the previous poll did not fill a batch),
  // bind the cursor a lookback earlier than the high-water mark and reset the
  // keyset tiebreak, so a row that committed late below the cursor is
  // re-fetched. While MID-DRAIN keep the strict keyset (see lastBatchFull).
  const midDrain = lastBatchFull.get(streamKey) === true;
  let useOverlap = false;
  let cursorBind: string | number | Date;
  if (isTs) {
    let ms: number;
    if (state.cursor === "") {
      // First poll: read only the initial horizon, not the whole history.
      const days = initialHorizonDaysOf(vendor, stream);
      ms = days === 0 ? 0 : domainNow - days * 86_400_000;
    } else {
      ms = parseCursorValue(state.cursor, "native") as number;
      useOverlap = !midDrain;
      if (useOverlap) {
        let lookback = Math.max(
          configuredLookbackMs(vendor, stream),
          2 * intervalMs(vendor, stream)
        );
        if (cursorIsWallClock(fmt, tz) && nearDstTransition(ms)) {
          lookback = Math.max(lookback, DST_LOOKBACK_MS);
        }
        ms -= lookback;
      }
    }
    cursorBind = formatCursorBind(ms, fmt);
  } else {
    cursorBind = initialCursorValue(state.cursor, stream);
  }

  // Keyset tiebreak (finding 6). Bound NUMERICALLY by default: tiebreakColumn
  // is normally an integer primary key. Number("") === 0 is the correct
  // first-poll sentinel. When the config declares tiebreakType: "string" (a UUID
  // / non-numeric key, L11) the tiebreak is bound and compared LEXICALLY
  // instead, with "" as the first-poll sentinel.
  const tiebreakType = stream.tiebreakColumn ? tiebreakTypeOf(stream) : undefined;
  let tiebreakBind =
    stream.tiebreakColumn
      ? tiebreakType === "string"
        ? state.cursorTiebreak
        : Number(state.cursorTiebreak)
      : undefined;
  if (useOverlap && stream.tiebreakColumn) {
    // A same-timestamp earlier-id row that the strict keyset would exclude must
    // be re-fetched: bind the low sentinel.
    tiebreakBind = tiebreakType === "string" ? "" : 0;
  }

  const queryParams: Record<string, string | number | Date> = {
    cursor: cursorBind,
    limit: vendor.batchSize,
  };
  if (tiebreakBind !== undefined) {
    queryParams.cursorTiebreak = tiebreakBind;
  }
  const runQuery = (p: Record<string, string | number | Date>): Promise<QueryResult> =>
    withDeadline(`${streamKey} query`, QUERY_DEADLINE_MS, () =>
      stream.cursorSqlType
        ? opts.driver.query(stream.query, p, { cursorSqlType: stream.cursorSqlType })
        : opts.driver.query(stream.query, p)
    );
  /** One page; when a FULL page does not move past its start key (a cluster of
   *  >= limit rows sharing one cursor value that the driver truncates, e.g.
   *  microseconds to milliseconds) re-run it with :limit x4 up to
   *  MAX_RAISED_LIMIT instead of re-reading the same page forever. */
  const readPage = async (
    p: Record<string, string | number | Date>,
    startCursor: string,
    startTiebreak: string
  ): Promise<{ res: QueryResult; limit: number }> => {
    let limit = Number(p.limit);
    let res = await runQuery(p);
    while (
      res.rows.length >= limit &&
      limit < MAX_RAISED_LIMIT &&
      !batchAdvancesBeyond(res.rows, startCursor, startTiebreak, stream, fmt, clampMs)
    ) {
      limit = Math.min(limit * 4, MAX_RAISED_LIMIT);
      console.warn(
        `[db-framework] ${streamKey}: a full batch did not advance the cursor; retrying with limit ${limit} (rows sharing one cursor value)`
      );
      res = await runQuery({ ...p, limit });
    }
    return { res, limit };
  };
  let result: QueryResult;
  let effectiveLimit = vendor.batchSize;
  // The overlap read reached the end of its window (a short last page).
  let overlapComplete = false;
  try {
    const first = await readPage(
      queryParams,
      useOverlap ? "" : state.cursor,
      useOverlap ? "" : state.cursorTiebreak
    );
    result = first.res;
    effectiveLimit = first.limit;
    if (useOverlap && isTs && result.rows.length >= effectiveLimit) {
      // Finding 10: the lookback overlap is a single LIMIT page from the window
      // start, so rows beyond the first page of the window were never
      // re-checked. Follow the window with strict keyset pages until a short
      // page (bounded; a hit cap is logged and the stream stays in drain mode).
      const all = result.rows.slice();
      let pageRows = result.rows;
      let pageLimit = effectiveLimit;
      let pages = 1;
      while (pageRows.length >= pageLimit && pages < OVERLAP_MAX_PAGES) {
        const last = pageRows[pageRows.length - 1];
        const next = keysetParamsAfter(last, stream, fmt, queryParams);
        const lastKey = rowKeyOf(last, stream, fmt, clampMs);
        if (!next || !lastKey) break;
        const page = await readPage(next, lastKey.cursor, lastKey.tiebreak);
        pages += 1;
        pageRows = page.res.rows;
        pageLimit = page.limit;
        if (pageRows.length === 0) break;
        if (!batchAdvancesBeyond(pageRows, lastKey.cursor, lastKey.tiebreak, stream, fmt, clampMs)) {
          break; // stuck on one cursor value even at the maximum limit
        }
        for (const r of pageRows) all.push(r);
      }
      overlapComplete = pageRows.length < pageLimit;
      if (!overlapComplete) {
        console.warn(
          `[db-framework] ${streamKey}: the overlap window is larger than ${pages} pages of ${pageLimit} rows; the rest is re-checked on the next polls`
        );
      }
      result = { columns: result.columns, rows: all };
    }
  } catch (err) {
    // Deadline expiry (C4): the connection is wedged (DB lock, half-dead
    // TCP). Discard it fire-and-forget: awaiting close() on a wedged
    // connection can itself hang, so the driver reconnects fresh on the
    // next poll instead of re-awaiting a call that never settles.
    if (err instanceof DeadlineExceededError) {
      void opts.driver.close().catch(() => void 0);
    }
    if (reprobe) {
      return keepHalted(state, now, `re-probe failed: ${errorMessage(err)}`);
    }
    if (err instanceof DeadlineExceededError) {
      return recordFailure(state, opts, (err as Error).message, now);
    }
    // A renamed/removed column or table makes the query THROW rather than
    // change the result-set shape, so the column-snapshot detector never sees
    // it. After SCHEMA_ERROR_THRESHOLD consecutive schema-class errors halt the
    // stream loudly (and report it); a single one is retried (review finding 2).
    if (isSchemaError(err)) {
      return handleSchemaError(state, opts, err, now, aux);
    }
    return recordFailure(state, opts, errorMessage(err), now);
  }
  if (aux.schemaErrors !== 0) aux.schemaErrors = 0;

  // Record whether this poll filled a batch, for the NEXT poll's overlap
  // decision (H8): a full batch means a backlog is still draining (stay on the
  // strict keyset); a short batch means we are caught up (apply the overlap).
  // The LIMIT is enforced in SQL, so rows.length === batchSize reliably means
  // "more may remain" regardless of any app-side row filtering. The same flag
  // drives catch-up scheduling below (L13).
  const batchWasFull = overlapComplete ? false : result.rows.length >= effectiveLimit;
  lastBatchFull.set(streamKey, batchWasFull);

  // L11: guard the integer-tiebreak assumption (see recordTiebreakConfigInvalid).
  if (stream.tiebreakColumn && tiebreakType === "integer") {
    const offending = firstNonNumericTiebreak(result.rows, stream.tiebreakColumn);
    if (offending !== null) {
      return recordTiebreakConfigInvalid(state, opts, offending, now, reprobe);
    }
  }

  // ---- schema drift detection / first-poll validation --------------------
  // An empty result.columns means the driver returned no field metadata for
  // THIS poll (some drivers omit it on a zero-row result), not that the table
  // lost every column; it carries no drift signal and is never baselined.
  let drift: DriftReport | null = null;
  let firstPollNote: string | null = null;
  // The cursor column's storage format is verified on the first poll even when
  // the query returned nothing: a cursor bound in the wrong format makes a
  // comparison match no row at all, which would otherwise look like an empty
  // table.
  if (isTs && state.columnSnapshot === null) {
    const mismatch = await checkCursorFormat(opts, result.rows, fmt, queryParams);
    if (mismatch) {
      const issue: ConfigInvalidFieldIssue = {
        field: stream.cursorColumn,
        reason: mismatch,
        sampleRawValues: result.rows
          .slice(0, 3)
          .map((r) => truncateRaw(r[stream.cursorColumn])),
      };
      return haltConfigInvalid(state, opts, now, reprobe, {
        sampleSize: Math.min(result.rows.length, FIRST_POLL_SAMPLE_SIZE),
        passingRows: 0,
        issues: [issue],
        lastError: `config invalid: ${mismatch}`,
      });
    }
  }
  if (result.columns.length === 0) {
    // No column information this poll; leave the snapshot untouched.
  } else if (state.columnSnapshot === null) {
    // First poll. The cursor column's storage format was checked above; now
    // validate the actual ROW DATA against the YAML map (Phase 5). Baselining a
    // config whose data does not normalise would silently ingest corrupt
    // revenue, so we refuse and halt instead.
    const validation = validateFirstPoll(result.rows, {
      clinicId: opts.clinicId,
      vendor,
      stream,
    });
    if (!validation.ok) {
      // A verdict needs a real sample: MIN_FIRST_POLL_SAMPLE rows, or the whole
      // table when it is smaller (verified by a COUNT). Two rows after a config
      // reload (one a patient-less calendar block) must not halt a healthy
      // stream.
      let conclusive = result.rows.length >= MIN_FIRST_POLL_SAMPLE;
      if (!conclusive) {
        const tableRows = await countTableRows(opts);
        conclusive = tableRows !== null && tableRows <= result.rows.length;
      }
      if (conclusive) {
        return haltConfigInvalid(state, opts, now, reprobe, {
          sampleSize: validation.sampleSize,
          passingRows: validation.passingRows,
          issues: validation.issues,
          lastError: `config invalid: ${validation.passingRows}/${
            validation.sampleSize
          } sampled rows valid; fields=${validation.issues.map((i) => i.field).join(",")}`,
        });
      }
      if (validation.passingRows === 0) {
        // Too little data to judge and nothing in it is valid: hold the rows
        // back (cursor untouched, they are re-read) until the sample grows.
        aux.deferredPolls += 1;
        if (aux.deferredPolls > MAX_DEFERRED_FIRST_POLLS) {
          return haltConfigInvalid(state, opts, now, reprobe, {
            sampleSize: validation.sampleSize,
            passingRows: validation.passingRows,
            issues: validation.issues,
            lastError: `config invalid: first-poll sample stayed below ${MIN_FIRST_POLL_SAMPLE} rows for ${aux.deferredPolls} polls and no row is valid; fields=${validation.issues
              .map((i) => i.field)
              .join(",")}`,
          });
        }
        state.lastError = `first-poll sample too small (${result.rows.length} of ${MIN_FIRST_POLL_SAMPLE} rows) and no row valid yet; waiting for more data (${aux.deferredPolls}/${MAX_DEFERRED_FIRST_POLLS})`;
        state.lastRunAt = now();
        state.nextRunAt = now() + intervalMs(vendor, stream);
        saveAuxIfCurrent(state, aux);
        commitState(state);
        return {
          emitted: 0,
          newCursor: state.cursor,
          driftDetected: false,
          driftReport: null,
        };
      }
      firstPollNote = `first-poll sample is small (${result.rows.length} rows): ${validation.passingRows}/${validation.sampleSize} valid; accepted`;
    }
    aux.deferredPolls = 0;
    state.columnSnapshot = result.columns;
  } else if (!columnsMatch(state.columnSnapshot, result.columns)) {
    drift = buildDriftReport(
      vendor.vendor,
      stream.kind,
      state.columnSnapshot,
      result.columns
    );
    const lastError = `schema drift: missing=${drift.missing.join(",")} added=${drift.added.join(",")}`;
    if (reprobe) return keepHalted(state, now, lastError);
    const report = drift;
    return haltStreamAndReport(state, opts, now, "schema_drift", lastError, {
      record: () => recordDrift(report),
      driftReport: drift,
    });
  }

  // ---- normalise + enqueue ---------------------------------------------
  let emitted = 0;
  let skippedRows = 0;
  let futureRows = 0;
  let maxCursor = state.cursor;
  let maxTiebreak = state.cursorTiebreak;
  const startCursor = state.cursor;
  const startTiebreak = state.cursorTiebreak;
  const tiebreakColumn = stream.tiebreakColumn;
  const ctx = {
    clinicId: opts.clinicId,
    vendor,
    stream,
  };
  // M-D2: post-baseline value-drift watch. For every emitted event we check the
  // fields backed by a key transform; when the transform dropped the field
  // (event[field] undefined) even though the raw source column held a non-empty
  // value, the vendor emitted a value the map no longer recognises. Counted and
  // sampled for a rate-limited warning below. Empty for streams with no key
  // transform so the hot path stays cheap.
  const keyTransformFieldList = keyTransformFields(stream);
  let unmappedValues = 0;
  const unmappedSamples = new Map<string, string>();
  const newAmounts: Array<[string, number]> = [];
  // Finding 7: payloads of the whole batch go to the outbox in ONE transaction
  // (enqueueMany) after the loop; per-row enqueue() is one autocommit fsync per
  // row and stalls the event loop for seconds on a large batch.
  const pending: Array<{ payload: string; contentHash: string }> = [];
  let skipReason: string | null = null;
  for (const row of result.rows) {
    // Compute this row's cursor position FIRST, guarded, so that even if
    // normalization fails below (H6) we still know whether it is safe to step
    // the cursor PAST this row. A row whose cursor VALUE itself is invalid
    // yields rowCursor === "" and never advances the cursor onto it.
    let rowCursor = "";
    let rowTiebreak = "";
    try {
      if (isTs) {
        const rowMs = parseCursorValue(row[stream.cursorColumn], fmt);
        if (rowMs !== null) {
          if (rowMs > clampMs) {
            // A sentinel date / typo / wrong clock: the row is real data and is
            // still emitted, but it must not drag the cursor into the future,
            // where every later row would stay below it forever.
            futureRows++;
            rowCursor = new Date(clampMs).toISOString();
          } else {
            rowCursor = new Date(rowMs).toISOString();
            if (tiebreakColumn) {
              rowTiebreak =
                row[tiebreakColumn] == null ? "" : String(row[tiebreakColumn]);
            }
          }
        }
      } else {
        rowCursor = stringifyCursor(row[stream.cursorColumn], stream, fmt);
        if (tiebreakColumn) {
          rowTiebreak =
            row[tiebreakColumn] == null ? "" : String(row[tiebreakColumn]);
        }
      }
    } catch {
      rowCursor = "";
    }

    let event: CanonicalEventBase | null = null;
    let normalizeThrew = false;
    try {
      event = normalizeRow(row, ctx);
    } catch (err) {
      // H6: a single row that throws during normalization (e.g. an Invalid
      // Date that escaped the transform guards, or a poisoned value whose
      // String() throws) is SKIPPED and counted; the poll CONTINUES with the
      // rest of the batch.
      normalizeThrew = true;
      skippedRows++;
      skipReason = "normalize_error";
      logSkippedRow(streamKey, stream, row, err);
    }

    if (event) {
      try {
        if (opts.sink) {
          opts.sink(event);
        } else {
          pending.push({
            payload: JSON.stringify(event),
            contentHash: event.pvsExternalEventId,
          });
        }
        emitted++;
      } catch (err) {
        // H5: building / delivering the event failed. Abort the ENTIRE batch
        // WITHOUT advancing the cursor past the failed row, and route through
        // recordFailure so the poll backs off and RE-READS these rows on the
        // next run.
        return recordFailure(
          state,
          opts,
          `outbox enqueue failed: ${(err as Error).message}`,
          now
        );
      }
      if (
        event.kind === "InvoicePaid" &&
        typeof event.amountCents === "number" &&
        Number.isFinite(event.amountCents)
      ) {
        newAmounts.push([event.pvsExternalEventId, event.amountCents]);
      }
      // M-D2: the event shipped, but a key-transform field may have been dropped
      // for an unrecognised source value. Flag those so a mid-life vendor change
      // does not silently corrupt ingestion.
      for (const f of keyTransformFieldList) {
        if (event[f] !== undefined) continue;
        const raw = rawValueForField(stream.map[f], row);
        if (raw === null || raw === undefined) continue;
        let rawStr = "";
        try {
          rawStr = String(raw);
        } catch {
          rawStr = "";
        }
        if (rawStr.trim() === "") continue;
        unmappedValues++;
        if (!unmappedSamples.has(f)) unmappedSamples.set(f, truncateRaw(raw));
      }
    } else if (!normalizeThrew) {
      // normalizeRow returned null: a required envelope field did not resolve
      // for this row (it already logged its own warning). Count it as skipped.
      // It is genuinely unprocessable, so the cursor is still allowed to advance
      // past it below (when its cursor value is valid).
      skippedRows++;
      skipReason = "missing_required_field";
    }

    // Advance the cursor for enqueued rows AND for skipped rows whose cursor
    // value is valid, so a single bad row cannot wedge the stream by being
    // re-read forever (H6).
    if (rowCursor) {
      if (tiebreakColumn) {
        if (
          cursorAdvances(
            rowCursor,
            rowTiebreak,
            maxCursor,
            maxTiebreak,
            stream.cursorType,
            tiebreakType
          )
        ) {
          maxCursor = rowCursor;
          maxTiebreak = rowTiebreak;
        }
      } else if (
        maxCursor === "" ||
        compareCursor(rowCursor, maxCursor, stream.cursorType) > 0
      ) {
        maxCursor = rowCursor;
      }
    }
  }

  // Atomic batch write. The UNIQUE(content_hash) dedup absorbs the re-enqueue of
  // rows written before a failure; the cursor below only advances after this
  // returned, so a throw aborts the batch and the rows are re-read.
  if (pending.length > 0) {
    try {
      enqueueMany(pending);
    } catch (err) {
      return recordFailure(
        state,
        opts,
        `outbox enqueue failed: ${(err as Error).message}`,
        now
      );
    }
  }

  if (skippedRows > 0) {
    aux.skippedRows += skippedRows;
    aux.lastSkipReason = skipReason;
    console.warn(
      `[db-framework] ${streamKey}: skipped ${skippedRows} row(s) this poll (normalization failed or a required field was missing).`
    );
  }

  if (unmappedValues > 0) {
    logValueDrift(streamKey, unmappedValues, unmappedSamples);
  }

  // ---- plausibility / data warnings -------------------------------------
  const warnings = updateWarnings(aux, newAmounts, futureRows, result.rows.length);
  if (firstPollNote) warnings.push(firstPollNote);
  if (futureRows > 0) {
    console.warn(`[db-framework] ${streamKey}: ${futureRows} rows with future modified_at`);
  }

  // ---- empty-stream diagnostic -------------------------------------------
  if (result.rows.length === 0) {
    if (!aux.everReturnedRows) {
      aux.emptyPolls += 1;
      if (aux.emptyPolls >= EMPTY_POLLS_BEFORE_DIAGNOSTIC && !aux.diagnosed) {
        await runEmptyDiagnostic(opts, aux);
      }
    }
  } else {
    aux.everReturnedRows = true;
    aux.emptyPolls = 0;
    aux.suspect = null;
    aux.lastRowAt = nowMs;
  }

  // Finding 6: a stream that DID return rows and then none for >= 7 days while a
  // sibling stream of the same vendor still delivers has most likely lost its
  // match (a status value renamed by a PVS update). Reported as the existing
  // suspect_empty state (the portal treats it as halted with action steps).
  let silentMessage: string | null = null;
  if (
    result.rows.length === 0 &&
    aux.everReturnedRows &&
    aux.lastRowAt !== null &&
    nowMs - aux.lastRowAt >= SILENT_STREAM_MS &&
    siblingStreamDelivers(vendor, stream, nowMs)
  ) {
    if (!aux.diagnosed) await runEmptyDiagnostic(opts, aux);
    const days = Math.floor((nowMs - aux.lastRowAt) / 86_400_000);
    const vals =
      aux.suspect && aux.suspect.statusValues.length > 0
        ? ` Statuswerte: [${aux.suspect.statusValues.join(", ")}].`
        : "";
    silentMessage = `Stream ${stream.kind} lieferte seit ${days} Tagen keine Zeilen (went silent), obwohl andere Streams derselben Anbindung weiter Daten liefern; Status-Literal oder Filter in der Abfrage prüfen (z. B. nach einem PVS-Update umbenannter Statuswert).${vals}`;
  }

  // ---- cursor must advance on a full batch ------------------------------
  // A full STRICT batch that did not move the cursor (cursorColumn missing from
  // the rows, NULLs, > batchSize rows sharing one timestamp with no tiebreak
  // column, a batch of nothing but future rows) would be re-read forever.
  if (
    batchWasFull &&
    !useOverlap &&
    ((maxCursor === startCursor && maxTiebreak === startTiebreak) ||
      futureRows >= result.rows.length)
  ) {
    const why =
      futureRows >= result.rows.length
        ? `every row of the batch is dated more than 10 minutes in the future (${futureRows} rows); check the PC clock / sentinel dates in '${stream.cursorColumn}'`
        : `a full batch of ${result.rows.length} rows did not move the cursor; check that cursorColumn '${stream.cursorColumn}' is selected and non-NULL${
            stream.tiebreakColumn ? "" : ", and set tiebreakColumn if more than batchSize rows can share one value"
          }`;
    saveAuxIfCurrent(state, aux);
    return haltConfigInvalid(
      state,
      opts,
      now,
      reprobe,
      {
        sampleSize: result.rows.length,
        passingRows: 0,
        issues: [
          {
            field: stream.cursorColumn,
            reason: `cursor does not advance: ${why}`,
            sampleRawValues: result.rows
              .slice(0, 3)
              .map((r) => truncateRaw(r[stream.cursorColumn])),
          },
        ],
        lastError: `config invalid: cursor does not advance: ${why}`,
      },
      emitted
    );
  }

  // ---- advance state ---------------------------------------------------
  const recovered = reprobe;
  state.cursor = maxCursor;
  state.cursorTiebreak = maxTiebreak;
  let status: StreamStatus = "idle";
  let lastError: string | null = warnings.length > 0 ? warnings.join(" | ") : null;
  if (silentMessage) {
    status = "suspect_empty";
    lastError = [silentMessage, ...warnings].join(" | ");
  } else if (aux.suspect && result.rows.length === 0) {
    status = "suspect_empty";
    lastError = [suspectMessage(aux.suspect, vendor, stream), ...warnings].join(" | ");
  }
  state.status = status;
  state.lastError = lastError ? lastError.slice(0, 900) : null;
  state.lastRunAt = now();
  state.consecutiveFailures = 0;
  // L13: drain a backlog fast. A full batch means more rows are waiting, so
  // re-poll after a short delay rather than the full interval; a short batch
  // means we are caught up, so return to normal cadence.
  state.nextRunAt =
    now() + (batchWasFull ? CATCHUP_DELAY_MS : intervalMs(vendor, stream));
  saveAuxIfCurrent(state, aux);
  commitState(state);
  if (recovered) {
    console.log(
      `[db-framework] ${streamKey}: re-probe succeeded; stream is running again`
    );
  }

  return {
    emitted,
    newCursor: maxCursor,
    driftDetected: false,
    driftReport: null,
    skippedRows,
    unmappedValues,
    futureRows,
    ...(recovered ? { recovered: true } : {}),
  };
}

/** Did another stream of this vendor return rows recently? (finding 6) */
function siblingStreamDelivers(
  vendor: VendorConfig,
  stream: StreamConfig,
  nowMs: number
): boolean {
  for (const other of vendor.streams) {
    if (other.kind === stream.kind) continue;
    const at = loadAux(vendor.vendor, other.kind).lastRowAt;
    if (at !== null && nowMs - at <= SIBLING_ACTIVE_MS && at <= nowMs) return true;
  }
  return false;
}

/** The (cursor, tiebreak) key of a row the same way the poll loop computes it,
 *  or null when the row has no usable cursor value. */
function rowKeyOf(
  row: Record<string, unknown>,
  stream: StreamConfig,
  fmt: CursorFormat,
  clampMs: number
): { cursor: string; tiebreak: string } | null {
  try {
    let cursor = "";
    let tiebreak = "";
    if (stream.cursorType === "timestamp") {
      const ms = parseCursorValue(row[stream.cursorColumn], fmt);
      if (ms === null) return null;
      if (ms > clampMs) {
        cursor = new Date(clampMs).toISOString();
      } else {
        cursor = new Date(ms).toISOString();
        if (stream.tiebreakColumn) {
          const t = row[stream.tiebreakColumn];
          tiebreak = t == null ? "" : String(t);
        }
      }
    } else {
      cursor = stringifyCursor(row[stream.cursorColumn], stream, fmt);
      if (stream.tiebreakColumn) {
        const t = row[stream.tiebreakColumn];
        tiebreak = t == null ? "" : String(t);
      }
    }
    return cursor ? { cursor, tiebreak } : null;
  } catch {
    return null;
  }
}

/** Would processing `rows` move the (cursor, tiebreak) high-water mark beyond
 *  the given start key? Mirrors the advance rule of the poll loop. */
function batchAdvancesBeyond(
  rows: Array<Record<string, unknown>>,
  startCursor: string,
  startTiebreak: string,
  stream: StreamConfig,
  fmt: CursorFormat,
  clampMs: number
): boolean {
  let maxCursor = startCursor;
  let maxTiebreak = startTiebreak;
  const tbType = stream.tiebreakColumn ? tiebreakTypeOf(stream) : undefined;
  for (const row of rows) {
    const k = rowKeyOf(row, stream, fmt, clampMs);
    if (!k) continue;
    if (stream.tiebreakColumn) {
      if (cursorAdvances(k.cursor, k.tiebreak, maxCursor, maxTiebreak, stream.cursorType, tbType)) {
        maxCursor = k.cursor;
        maxTiebreak = k.tiebreak;
      }
    } else if (maxCursor === "" || compareCursor(k.cursor, maxCursor, stream.cursorType) > 0) {
      maxCursor = k.cursor;
    }
  }
  return maxCursor !== startCursor || maxTiebreak !== startTiebreak;
}

/** Strict-keyset parameters for the page that follows `last` (overlap paging). */
function keysetParamsAfter(
  last: Record<string, unknown>,
  stream: StreamConfig,
  fmt: CursorFormat,
  base: Record<string, string | number | Date>
): Record<string, string | number | Date> | null {
  const ms = parseCursorValue(last[stream.cursorColumn], fmt);
  if (ms === null) return null;
  const next: Record<string, string | number | Date> = {
    ...base,
    cursor: formatCursorBind(ms, fmt),
  };
  if (stream.tiebreakColumn) {
    const raw = last[stream.tiebreakColumn];
    if (tiebreakTypeOf(stream) === "string") {
      next.cursorTiebreak = raw == null ? "" : String(raw);
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      next.cursorTiebreak = n;
    }
  }
  return next;
}

function saveAuxIfCurrent(state: StreamState, aux: StreamAux): void {
  if (!isStale(state)) saveAux(state.vendorId, state.streamKind, aux);
}

// ---------- halting -------------------------------------------------------

/** A re-probe that failed again: stay halted, push the next probe out, file no
 *  new report. */
function keepHalted(
  state: StreamState,
  now: () => number,
  lastError: string
): PollOutcome {
  state.lastError = lastError.slice(0, 900);
  state.lastRunAt = now();
  state.nextRunAt = now() + REPROBE_MS;
  commitState(state);
  return haltedNoop(state);
}

/**
 * Halt a stream and (unless this is a re-probe or the state is stale) file its
 * report. The halt is re-probed every REPROBE_MS (see pollInner).
 */
function haltStreamAndReport(
  state: StreamState,
  opts: PollOptions,
  now: () => number,
  status: "schema_drift" | "config_invalid",
  lastError: string,
  extra: {
    record: () => void;
    driftReport?: DriftReport | null;
    emitted?: number;
  }
): PollOutcome {
  if (!isStale(state)) extra.record();
  state.status = status;
  state.lastError = lastError.slice(0, 900);
  state.lastRunAt = now();
  state.nextRunAt = now() + REPROBE_MS;
  commitState(state);
  console.warn(
    `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: stream halted as ${status}: ${lastError}`
  );
  return {
    emitted: extra.emitted ?? 0,
    newCursor: state.cursor,
    driftDetected: status === "schema_drift",
    driftReport: extra.driftReport ?? null,
  };
}

function haltConfigInvalid(
  state: StreamState,
  opts: PollOptions,
  now: () => number,
  reprobe: boolean,
  info: {
    sampleSize: number;
    passingRows: number;
    issues: ConfigInvalidFieldIssue[];
    lastError: string;
  },
  emitted = 0
): PollOutcome {
  if (reprobe) return keepHalted(state, now, info.lastError);
  // Leave columnSnapshot null on purpose: the config was never confirmed, so
  // when the stream is next run (re-probe, or after the operator fixes the
  // config) the first poll re-validates instead of trusting un-validated data.
  return haltStreamAndReport(state, opts, now, "config_invalid", info.lastError, {
    emitted,
    record: () =>
      recordConfigInvalid({
        vendorId: opts.vendor.vendor,
        streamKind: opts.stream.kind,
        sampleSize: info.sampleSize,
        passingRows: info.passingRows,
        threshold: MIN_PASS_FRACTION,
        issues: info.issues,
        detectedAt: new Date().toISOString(),
      }),
  });
}

/**
 * A schema-class query error. The first SCHEMA_ERROR_THRESHOLD-1 are retried
 * with backoff (a view being rebuilt, a PVS update in progress); the
 * SCHEMA_ERROR_THRESHOLD-th consecutive one halts the stream and files a drift
 * report that carries the catalog (table/column names, types, row counts; no
 * row data) so the operator sees what the database actually contains.
 */
async function handleSchemaError(
  state: StreamState,
  opts: PollOptions,
  err: unknown,
  now: () => number,
  aux: StreamAux
): Promise<PollOutcome> {
  aux.schemaErrors += 1;
  const msg = errorMessage(err);
  if (aux.schemaErrors < SCHEMA_ERROR_THRESHOLD) {
    state.lastError = `schema error ${aux.schemaErrors}/${SCHEMA_ERROR_THRESHOLD} (retrying before the stream is halted): ${msg}`.slice(
      0,
      900
    );
    state.lastRunAt = now();
    state.nextRunAt = now() + backoffMs(aux.schemaErrors);
    saveAuxIfCurrent(state, aux);
    commitState(state);
    return { emitted: 0, newCursor: state.cursor, driftDetected: false, driftReport: null };
  }

  let missing: string[];
  if (isTableMissingError(err)) {
    const table =
      extractMissingTable(err) ??
      opts.stream.diagnosticTable ??
      baseTable(opts.stream.query);
    missing = table ? [table] : extractDriftColumns(err, state.columnSnapshot);
  } else {
    missing = extractDriftColumns(err, state.columnSnapshot);
  }
  const catalog = await buildCatalog(opts);
  const report: DriftReport = {
    vendorId: opts.vendor.vendor,
    streamKind: opts.stream.kind,
    expectedColumns: state.columnSnapshot ?? [],
    observedColumns: [],
    missing,
    added: [],
    detectedAt: new Date().toISOString(),
    ...(catalog ? { catalog } : {}),
  };
  saveAuxIfCurrent(state, aux);
  return haltStreamAndReport(
    state,
    opts,
    now,
    "schema_drift",
    `schema error (stream halted): ${msg}`,
    { record: () => recordDrift(report), driftReport: report }
  );
}

/** Catalog snapshot for a drift report; never throws, never blocks long. */
async function buildCatalog(opts: PollOptions): Promise<CatalogSummary | undefined> {
  try {
    const probe = await withDeadline(
      `${opts.vendor.vendor} schema probe`,
      DIAGNOSTIC_DEADLINE_MS,
      () => probeSchema(opts.driver, opts.vendor)
    );
    return summarizeForReport(probe, opts.vendor);
  } catch (err) {
    console.warn(
      `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: catalog introspection failed: ${errorMessage(err)}`
    );
    return undefined;
  }
}

// ---------- cursor format check ------------------------------------------

/**
 * First-poll check that the cursor column really is stored the way
 * cursorFormat says. Binding a 'YYYY-MM-DDTHH:MM:SSZ' text cursor against a
 * 'YYYY-MM-DD HH:MM:SS' column compares lexically LOWER for same-day rows (they
 * are lost forever); an epoch integer never compares > a text cursor. Returns a
 * description of the mismatch, or null.
 */
async function checkCursorFormat(
  opts: PollOptions,
  rows: Record<string, unknown>[],
  fmt: CursorFormat,
  params: Record<string, string | number | Date>
): Promise<string | null> {
  const col = opts.stream.cursorColumn;
  const sampler = opts.driver as unknown as Partial<StorageTypeSampler>;
  if (fmt !== "native" && typeof sampler.sampleStorageTypes === "function") {
    try {
      const types = await withDeadline(
        `${opts.vendor.vendor} storage-type sample`,
        DIAGNOSTIC_DEADLINE_MS,
        () => sampler.sampleStorageTypes!(opts.stream.query, params, col)
      );
      let found = Object.entries(types)
        .filter(([k, n]) => k !== "null" && n > 0)
        .map(([k]) => k);
      if (found.length === 0 && typeof sampler.sampleTableStorageTypes === "function") {
        // The query returned nothing (a wrong-format cursor matches no row), so
        // look at the base table directly.
        const table = diagnosticTableOf(opts.stream);
        if (table) {
          const direct = await withDeadline(
            `${opts.vendor.vendor} table storage-type sample`,
            DIAGNOSTIC_DEADLINE_MS,
            () => sampler.sampleTableStorageTypes!(table, col)
          );
          found = Object.entries(direct)
            .filter(([k, n]) => k !== "null" && n > 0)
            .map(([k]) => k);
        }
      }
      const allowed =
        fmt === "iso_text" || fmt === "iso_t_text"
          ? ["text"]
          : fmt === "julian"
            ? ["real", "integer"]
            : ["integer", "real"];
      if (found.some((t) => !allowed.includes(t))) {
        return `cursorColumn '${col}' is stored as ${found.join("/")} but cursorFormat '${fmt}' expects ${allowed.join("/")}; set cursorFormat to match the column (iso_text | iso_t_text | epoch_s | epoch_ms | julian)`;
      }
    } catch {
      // The typeof() probe is best-effort; the row check below still runs.
    }
  }
  for (const row of rows.slice(0, 50)) {
    const found = describeCursorFormatMismatch(row[col], fmt);
    if (found) {
      return `cursorColumn '${col}' holds ${found} but cursorFormat is '${fmt}'; set cursorFormat to match the column (iso_text | iso_t_text | epoch_s | epoch_ms | julian | native)`;
    }
  }
  return null;
}

// ---------- empty-stream diagnostic + plausibility -------------------------

function diagnosticTableOf(stream: StreamConfig): string | null {
  const t = stream.diagnosticTable ?? baseTable(stream.query);
  return t && isSafeIdentifierPath(t) ? t : null;
}

/** `SELECT COUNT(*)` of the stream's base table, or null when it cannot be
 *  determined or the query fails. */
async function countTableRows(opts: PollOptions): Promise<number | null> {
  const table = diagnosticTableOf(opts.stream);
  if (!table) return null;
  try {
    const r = await withDeadline(
      `${opts.vendor.vendor}/${opts.stream.kind} diagnostic count`,
      DIAGNOSTIC_DEADLINE_MS,
      () => opts.driver.query(`SELECT COUNT(*) AS n FROM ${table}`, {})
    );
    const first = r.rows[0] ? Object.values(r.rows[0])[0] : null;
    const n = Number(first);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Engine-specific "first 20 distinct values of one column". */
function distinctValuesSql(
  engine: DbDriver["engine"],
  column: string,
  table: string
): string {
  switch (engine) {
    case "mssql":
      return `SELECT DISTINCT TOP 20 ${column} FROM ${table}`;
    case "oracle":
      return `SELECT DISTINCT ${column} FROM ${table} FETCH FIRST 20 ROWS ONLY`;
    case "firebird":
      return `SELECT DISTINCT ${column} FROM ${table} ROWS 20`;
    default:
      return `SELECT DISTINCT ${column} FROM ${table} LIMIT 20`;
  }
}

/**
 * The stream has returned nothing for its first polls. An empty table is fine;
 * a table WITH rows that the stream query never matches usually means a wrong
 * status literal or filter ('bezahlt' vs 'B'). Count the base table and, when a
 * statusColumn is configured, list its distinct values (status codes only,
 * never patient data) so the portal can show why nothing arrives.
 */
async function runEmptyDiagnostic(opts: PollOptions, aux: StreamAux): Promise<void> {
  aux.diagnosed = true;
  const table = diagnosticTableOf(opts.stream);
  if (!table) {
    console.warn(
      `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: stream is empty but its base table cannot be derived; set diagnosticTable in the YAML to enable the empty-stream diagnostic`
    );
    return;
  }
  const count = await countTableRows(opts);
  if (count === null || count <= 0) return;
  const statusValues: string[] = [];
  const col = opts.stream.statusColumn;
  if (col && isSafeIdentifierPath(col)) {
    try {
      const r = await withDeadline(
        `${opts.vendor.vendor}/${opts.stream.kind} status values`,
        DIAGNOSTIC_DEADLINE_MS,
        () => opts.driver.query(distinctValuesSql(opts.driver.engine, col, table), {})
      );
      for (const row of r.rows.slice(0, 20)) {
        const v = Object.values(row)[0];
        statusValues.push(v === null || v === undefined ? "<NULL>" : truncateRaw(v).slice(0, 40));
      }
    } catch {
      // The count alone still tells the story.
    }
  }
  aux.suspect = { table, rowCount: count, statusValues };
  console.warn(
    `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: ${suspectMessage(aux.suspect, opts.vendor, opts.stream)}`
  );
}

function suspectMessage(
  s: NonNullable<StreamAux["suspect"]>,
  vendor: VendorConfig,
  stream: StreamConfig
): string {
  const days = initialHorizonDaysOf(vendor, stream);
  const vals = s.statusValues.length > 0 ? ` Statuswerte: [${s.statusValues.join(", ")}].` : "";
  return `Stream liefert keine Zeilen, obwohl ${s.table} ${s.rowCount} Zeilen hat${
    days > 0 ? ` (Lesefenster: ${days} Tage)` : ""
  }; Status-Literal oder Filter in der Abfrage prüfen.${vals}`;
}

/**
 * Refresh the warning list: future-dated rows and InvoicePaid amount
 * plausibility. Amount problems are flagged, never suppressed: an amount that
 * is 100x off (euros read as cents or vice versa) still ships, but the heartbeat
 * says so.
 */
function updateWarnings(
  aux: StreamAux,
  newAmounts: Array<[string, number]>,
  futureRows: number,
  rowCount: number
): string[] {
  if (rowCount > 0) aux.futureRows = futureRows;
  const seen = new Set(aux.amounts.map(([id]) => id));
  for (const [id, cents] of newAmounts) {
    if (cents > AMOUNT_HIGH_CENTS && !aux.highAmountIds.includes(id)) {
      aux.highAmountIds.push(id);
      if (aux.highAmountIds.length > 20) aux.highAmountIds.shift();
    }
    if (!seen.has(id)) {
      aux.amounts.push([id, cents]);
      seen.add(id);
    }
  }
  if (aux.amounts.length > 60) aux.amounts = aux.amounts.slice(-60);

  const out: string[] = [];
  if (aux.futureRows > 0) {
    out.push(`${aux.futureRows} rows with future modified_at`);
  }
  if (aux.highAmountIds.length > 0) {
    out.push(
      `${aux.highAmountIds.length} InvoicePaid mit Betrag über 50.000 EUR (Cent/Euro-Einheit prüfen)`
    );
  }
  if (aux.amounts.length >= AMOUNT_MEDIAN_MIN_ROWS) {
    const sorted = aux.amounts.map(([, c]) => c).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median < 100) {
      out.push(
        `InvoicePaid: Median-Betrag unter 1 EUR nach ${aux.amounts.length} Zeilen (Euro statt Cent gelesen?)`
      );
    }
  }
  aux.warnings = out;
  return [...out];
}

// ---------- helpers -------------------------------------------------------

/** Rate-limited per-row skip log (H6). A systematically bad column would
 *  otherwise log on every poll; this caps it to once per SKIP_LOG_INTERVAL_MS
 *  per stream and names the stream plus the row's primary key. */
function logSkippedRow(
  streamKey: string,
  stream: StreamConfig,
  row: Record<string, unknown>,
  err: unknown
): void {
  const nowMs = Date.now();
  const last = lastSkipLogAt.get(streamKey) ?? 0;
  if (nowMs - last < SKIP_LOG_INTERVAL_MS) return;
  lastSkipLogAt.set(streamKey, nowMs);
  const pkCol = stream.tiebreakColumn ?? stream.cursorColumn;
  const pk = pkCol ? row[pkCol] : undefined;
  console.warn(
    `[db-framework] ${streamKey}: skipped a row that failed to normalize (${pkCol}=${
      pk === undefined || pk === null ? "<unknown>" : String(pk)
    }): ${(err as Error).message}`
  );
}

/** Canonical event fields whose mapping uses a key transform (M-D2). Their
 *  silent drop after baselining is the value drift this watch surfaces. */
function keyTransformFields(stream: StreamConfig): string[] {
  const out: string[] = [];
  for (const [field, mapping] of Object.entries(stream.map)) {
    const t = transformOf(mapping);
    if (t && KEY_TRANSFORMS.has(t)) out.push(field);
  }
  return out;
}

/** Rate-limited post-baseline value-drift log (M-D2). Names the fields whose
 *  key transform dropped an unrecognised source value on this poll's emitted
 *  events, with a sample raw value each, capped to one line per stream per
 *  VALUE_DRIFT_LOG_INTERVAL_MS. Does NOT halt the stream: healthy events keep
 *  flowing while the operator updates the vendor map. */
function logValueDrift(
  streamKey: string,
  count: number,
  samples: Map<string, string>
): void {
  const nowMs = Date.now();
  const last = lastValueDriftLogAt.get(streamKey) ?? 0;
  if (nowMs - last < VALUE_DRIFT_LOG_INTERVAL_MS) return;
  lastValueDriftLogAt.set(streamKey, nowMs);
  const detail = [...samples.entries()]
    .map(([field, sample]) => `${field} (z. B. '${sample}')`)
    .join(", ");
  console.warn(
    `[db-framework] ${streamKey}: post-baseline value drift on ${count} emitted event(s): a key field was dropped for an unrecognised source value [${detail}]. The portal worker discards the missing field; update the vendor map/transform to cover the new value.`
  );
}

/** Effective tiebreak comparison type for a stream (L11). Defaults to integer
 *  so existing keyset configs (an integer PK tiebreak) are unchanged. */
function tiebreakTypeOf(stream: StreamConfig): "integer" | "string" {
  return stream.tiebreakType ?? "integer";
}

/** First present-but-non-numeric tiebreak value in the batch, or null when all
 *  tiebreak values are numeric / absent (L11). A UUID PK bound through the
 *  default integer path shows up here so the caller can halt loudly instead of
 *  comparing NaN. Guards String() so a poison value cannot escape as a throw. */
function firstNonNumericTiebreak(
  rows: Record<string, unknown>[],
  tiebreakColumn: string
): string | null {
  for (const row of rows) {
    const raw = row[tiebreakColumn];
    if (raw === null || raw === undefined) continue;
    let s: string;
    try {
      s = String(raw);
    } catch {
      return "<nicht darstellbar>";
    }
    if (s === "") continue;
    if (!Number.isSafeInteger(Number(s))) return s;
  }
  return null;
}

/** Halt a stream whose integer-typed tiebreak column returned a non-numeric
 *  value (L11): record a config_invalid report naming the column and stop
 *  polling until the operator declares tiebreakType: string (or fixes the
 *  column). Mirrors the first-poll config_invalid halt path. */
function recordTiebreakConfigInvalid(
  state: StreamState,
  opts: PollOptions,
  offending: string,
  now: () => number,
  reprobe: boolean
): PollOutcome {
  const field = opts.stream.tiebreakColumn ?? "tiebreak";
  return haltConfigInvalid(state, opts, now, reprobe, {
    sampleSize: opts.stream.tiebreakColumn ? 1 : 0,
    passingRows: 0,
    issues: [
      {
        field,
        reason: `tiebreakColumn '${field}' liefert nicht-numerische Werte; setzen Sie tiebreakType: string für einen nicht-numerischen Schlüssel (z. B. UUID)`,
        sampleRawValues: [offending.slice(0, 60)],
      },
    ],
    lastError: `tiebreak not numeric: ${field}=${offending}; set tiebreakType: string`,
  });
}

function recordFailure(
  state: StreamState,
  opts: PollOptions,
  reason: string,
  now: () => number
): PollOutcome {
  state.consecutiveFailures += 1;
  state.lastError = reason.slice(0, 900);
  state.lastRunAt = now();
  state.status = state.consecutiveFailures >= FAIL_THRESHOLD ? "error" : "idle";
  state.nextRunAt = now() + backoffMs(state.consecutiveFailures);
  commitState(state);
  console.error(
    `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind} failed (#${state.consecutiveFailures}): ${reason}`
  );
  return {
    emitted: 0,
    newCursor: state.cursor,
    driftDetected: false,
    driftReport: null,
  };
}

/** recordFailure that survives its own failure (saveState on a full disk): the
 *  backoff is then held in memory so the stream still stops hammering. */
function recordFailureSafe(
  state: StreamState,
  opts: PollOptions,
  reason: string,
  now: () => number
): PollOutcome {
  try {
    return recordFailure(state, opts, reason, now);
  } catch (err) {
    const key = `${opts.vendor.vendor}/${opts.stream.kind}`;
    memoryNextRun.set(key, now() + backoffMs(Math.max(1, state.consecutiveFailures)));
    console.error(
      `[db-framework] ${key}: ${reason} (and the failure could not be persisted: ${errorMessage(err)}); backing off in memory`
    );
    return {
      emitted: 0,
      newCursor: state.cursor,
      driftDetected: false,
      driftReport: null,
    };
  }
}

/** Record a failure for a stream the runner could not even start polling (the
 *  tick promise rejected). Exported for the runner. */
export function recordStreamFailure(
  vendor: VendorConfig,
  stream: StreamConfig,
  reason: string,
  now: () => number = Date.now
): void {
  try {
    const state = loadState(vendor.vendor, stream.kind);
    trackGeneration(state);
    recordFailureSafe(
      state,
      { clinicId: "", vendor, stream, driver: null as unknown as DbDriver },
      reason,
      now
    );
  } catch (err) {
    memoryNextRun.set(`${vendor.vendor}/${stream.kind}`, now() + backoffMs(1));
    console.error(
      `[db-framework] ${vendor.vendor}/${stream.kind}: ${reason} (state unavailable: ${errorMessage(err)})`
    );
  }
}

/**
 * Classify a query error as schema drift vs. a transient/operational failure.
 *
 * The column-snapshot comparison in pollOnce only catches drift when the
 * result-set SHAPE changes, which never happens for our explicit-column
 * SELECTs. A vendor that renames a column makes the query throw "column does
 * not exist" instead. So the real-world drift signal is a specific class of
 * SQL error. We map the unambiguous "undefined column / table / identifier"
 * codes per engine; everything else (connection refused, timeout, auth) stays
 * a transient failure that retries. Conservative on purpose: misclassifying a
 * transient error would wrongly halt a healthy stream.
 */
export function isSchemaError(err: unknown): boolean {
  const e = err as
    | { code?: unknown; errno?: unknown; number?: unknown; errorNum?: unknown; message?: unknown }
    | null;
  if (!e || typeof e !== "object") return false;
  const code = typeof e.code === "string" ? e.code : "";
  // PostgreSQL SQLSTATE: 42703 undefined_column, 42P01 undefined_table.
  if (code === "42703" || code === "42P01") return true;
  // MySQL / MariaDB: ER_BAD_FIELD_ERROR (1054), ER_NO_SUCH_TABLE (1146).
  if (code === "ER_BAD_FIELD_ERROR" || code === "ER_NO_SUCH_TABLE") return true;
  if (e.errno === 1054 || e.errno === 1146) return true;
  // MS SQL Server: 207 invalid column name, 208 invalid object name.
  if (e.number === 207 || e.number === 208) return true;
  // Oracle: ORA-00904 invalid identifier, ORA-00942 table/view does not exist.
  if (e.errorNum === 904 || e.errorNum === 942) return true;
  // Message fallback for engines without clean codes (Firebird, SQLite).
  const msg = String(e.message ?? "");
  return (
    /no such (?:column|table)/i.test(msg) ||
    /unknown column/i.test(msg) ||
    /column unknown/i.test(msg) ||
    /table unknown/i.test(msg) ||
    /invalid column name/i.test(msg) ||
    /invalid identifier/i.test(msg) ||
    /(?:column|relation|table)\b.*does not exist/i.test(msg)
  );
}

/** Best-effort extraction of the offending column from a schema error so the
 *  drift report (and the portal health card) names it. Falls back to the prior
 *  column snapshot when the engine's message isn't parseable. */
function extractDriftColumns(err: unknown, snapshot: string[] | null): string[] {
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  const patterns = [
    /column "([^"]+)" does not exist/i, // postgres
    /Unknown column '([^']+)'/i, // mysql
    /no such column:\s*([A-Za-z0-9_."]+)/i, // sqlite
    /Invalid column name '([^']+)'/i, // mssql
    /"([^"]+)":\s*invalid identifier/i, // oracle ORA-00904
    /Column unknown\s*[\r\n]+\s*([A-Za-z0-9_$]+)/i, // firebird
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m?.[1]) return [m[1]];
  }
  return snapshot ?? [];
}

function backoffMs(n: number): number {
  return Math.min(60 * 60_000, 30_000 * Math.pow(2, n - 1));
}

export function intervalMs(vendor: VendorConfig, stream: StreamConfig): number {
  const seconds = stream.intervalSeconds ?? vendor.defaultIntervalSeconds;
  return Math.max(1_000, seconds * 1_000);
}

function initialCursorValue(
  cursor: string,
  stream: StreamConfig
): string | number | Date {
  switch (stream.cursorType) {
    case "timestamp":
      // Bind a timestamp cursor as a native Date so each driver coerces it to
      // the column's native temporal type. An ISO-8601 'Z' STRING only works
      // against Postgres; Firebird, Oracle, MSSQL and MySQL throw or match
      // nothing against a native TIMESTAMP on poll #1 (the bug Phase 3 fixes).
      // The stored cursor stays an ISO string (stringifyCursor), so the
      // round-trip is store-as-ISO / bind-as-Date. Both `:cursor` occurrences
      // in a keyset query (`cur > :cursor` and `cur = :cursor`) share this one
      // bind, so they get the same Date automatically.
      return cursor === ""
        ? new Date("1970-01-01T00:00:00.000Z")
        : new Date(cursor);
    case "integer":
      // First-poll sentinel is 0; stored cursors parse back as Number. The
      // advance compare is numeric for integer cursors (compareCursor), so a
      // stream whose cursor crosses a power-of-ten boundary still progresses; no
      // config uses cursorType: integer today, but the path is now correct for
      // the first one that does.
      return cursor === "" ? 0 : Number(cursor);
    case "string":
      // First poll: "" already matches the sentinel; thereafter the stored
      // value is bound verbatim.
      return cursor;
  }
}

function stringifyCursor(
  value: unknown,
  stream: StreamConfig,
  fmt: CursorFormat = "native"
): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // An Invalid Date (legacy zero-date in the cursor column) would throw on
    // toISOString(); return "" so the caller does not advance the cursor onto
    // an unrepresentable value (H6).
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (stream.cursorType === "timestamp") {
    // Text / epoch cursor columns: normalise to the same ISO form a Date column
    // yields, so every timestamp cursor compares lexically and binds back
    // through the configured cursorFormat.
    const ms = parseCursorValue(value, fmt);
    return ms === null ? "" : new Date(ms).toISOString();
  }
  if (stream.cursorType === "integer") {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "";
  }
  return String(value);
}

function columnsMatch(expected: string[], observed: string[]): boolean {
  if (expected.length !== observed.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== observed[i]) return false;
  }
  return true;
}

/**
 * Composite-cursor comparison for keyset pagination (review finding 6).
 * Returns true when (rowCursor, rowTiebreak) sorts strictly AFTER the current
 * max. The cursor compares via `compareCursor` (NUMERICALLY for integer
 * cursors, lexically for ISO-8601 timestamp and string cursors); on a tie the
 * tiebreak compares NUMERICALLY, matching the query's
 * `ORDER BY cursorColumn ASC, id ASC` and the integer `id > :cursorTiebreak`
 * predicate (so id 10 sorts after id 9, not before it as a lexical compare
 * would have it).
 */
function cursorAdvances(
  rowCursor: string,
  rowTiebreak: string,
  maxCursor: string,
  maxTiebreak: string,
  cursorType: StreamConfig["cursorType"],
  tiebreakType?: StreamConfig["tiebreakType"]
): boolean {
  if (maxCursor === "") return true;
  const cmp = compareCursor(rowCursor, maxCursor, cursorType);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  // Default (integer) tiebreak compares numerically (id 10 sorts after id 9);
  // a "string" tiebreak (UUID / non-numeric key, L11) compares lexically to
  // match the query's `id > :cursorTiebreak` on a text-ordered column.
  return tiebreakType === "string"
    ? rowTiebreak > maxTiebreak
    : Number(rowTiebreak) > Number(maxTiebreak);
}

/**
 * Order two stringified cursor values for the same stream. Integer cursors MUST
 * compare numerically: stringified integers do NOT sort lexically ("10" < "9"),
 * so a lexical compare would stall an integer stream the moment its cursor
 * crossed a power-of-ten boundary (the latent bug Phase 10 fixes; no config
 * uses `cursorType: integer` today). Timestamp (ISO-8601) and string cursors
 * are already lexically ordered, so they compare as plain strings. Returns a
 * negative, zero, or positive number like the standard comparator contract.
 */
function compareCursor(
  a: string,
  b: string,
  cursorType: StreamConfig["cursorType"]
): number {
  if (cursorType === "integer") {
    const na = Number(a);
    const nb = Number(b);
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------- first-poll value validation (Phase 5) ------------------------

/** Rows sampled from the first poll for value validation. */
const FIRST_POLL_SAMPLE_SIZE = 25;
/**
 * Minimum fraction of sampled rows that must fully normalise for the config to
 * be accepted. A healthy config normalises ~all rows; a systematic config
 * error (wrong status codes, mostly-NULL required column) fails ~all of them,
 * so the gap is wide. The 20% slack tolerates the occasional genuinely-partial
 * historical row without halting a healthy stream.
 */
const MIN_PASS_FRACTION = 0.8;
/**
 * Transforms whose silent failure is the corruption this validator exists to
 * catch: a status code that maps to nothing, a non-numeric / mis-located
 * amount, a malformed timestamp. When one of these yields undefined the field
 * is dropped, so we treat it the same as a missing required field.
 */
const KEY_TRANSFORMS: ReadonlySet<TransformName> = new Set([
  "appointmentStatus",
  "amountToCents",
  "absAmountToCents",
  "isoDateTime",
]);
const MAX_RAW_SAMPLES_PER_FIELD = 3;
const RAW_SAMPLE_MAX_LEN = 60;

export interface FirstPollValidation {
  ok: boolean;
  sampleSize: number;
  passingRows: number;
  threshold: number;
  issues: ConfigInvalidFieldIssue[];
}

function transformOf(
  mapping: FieldMapping | undefined
): TransformName | undefined {
  if (mapping && typeof mapping === "object" && "transform" in mapping) {
    return mapping.transform;
  }
  return undefined;
}

/**
 * The canonical fields a row must resolve for the config to count it valid:
 * the always-required envelope, the kind's required fields, plus any field
 * whose mapping uses a key transform (even if otherwise optional).
 */
function fieldsToValidate(stream: StreamConfig): string[] {
  const out = new Set<string>([
    ...ALWAYS_REQUIRED,
    ...REQUIRED_FIELDS_BY_KIND[stream.kind],
  ]);
  for (const [field, mapping] of Object.entries(stream.map)) {
    const transform = transformOf(mapping);
    if (transform && KEY_TRANSFORMS.has(transform)) out.add(field);
  }
  return [...out];
}

/** The raw source-column value behind a field, for diagnostics. Templates and
 *  literals have no single source column, so they surface nothing. */
function rawValueForField(
  mapping: FieldMapping | undefined,
  row: Record<string, unknown>
): unknown {
  if (mapping === undefined) return undefined;
  if (typeof mapping === "string") return row[mapping];
  if (mapping.from) return row[mapping.from];
  return undefined;
}

function reasonForField(
  mapping: FieldMapping | undefined,
  failed: number,
  total: number
): string {
  const transform = transformOf(mapping);
  if (transform) {
    return `Transformation '${transform}' ergab in ${failed}/${total} Stichproben-Zeilen keinen gültigen Wert`;
  }
  return `Pflichtfeld in ${failed}/${total} Stichproben-Zeilen leer`;
}

function truncateRaw(v: unknown): string {
  const s = v === null || v === undefined ? "<leer>" : String(v);
  return s.length > RAW_SAMPLE_MAX_LEN
    ? `${s.slice(0, RAW_SAMPLE_MAX_LEN)}...`
    : s;
}

/**
 * Validate the first poll's row data against the stream's YAML map. Samples up
 * to FIRST_POLL_SAMPLE_SIZE rows, runs the real normalizer on each, and counts
 * a row valid only when the envelope resolves (normalizeRow !== null) AND every
 * field in fieldsToValidate resolves to a defined value. Returns the pass-
 * fraction verdict plus a per-field issue list (which field, why, sample raw
 * values) for the health card.
 *
 * An empty first poll is accepted (nothing to validate): a table that happens
 * to be empty right now must not be mistaken for a broken config.
 */
function validateFirstPoll(
  rows: Record<string, unknown>[],
  ctx: { clinicId: string; vendor: VendorConfig; stream: StreamConfig }
): FirstPollValidation {
  // M-D7: sample the NEWEST rows of the batch, not the oldest. The first poll
  // binds an epoch cursor and the stream query orders by the cursor ASC, so
  // rows[0..] are the OLDEST records in the table (often 15-20 years of legacy
  // data whose format predates the current YAML map). Validating those raised
  // false config_invalid halts on healthy configs while letting current-format
  // defects through. Taking the tail (rows ordered ASC, so the last entries are
  // the most recent in the batch) judges the config against the freshest data
  // available in the poll. NOTE: on a fresh enrolment against a very large
  // history table the whole first batch can still be old; a fully current sample
  // would need a dedicated newest-first probe query, flagged as a follow-up.
  const sample = rows.slice(-FIRST_POLL_SAMPLE_SIZE);
  const total = sample.length;
  if (total === 0) {
    return {
      ok: true,
      sampleSize: 0,
      passingRows: 0,
      threshold: MIN_PASS_FRACTION,
      issues: [],
    };
  }

  const fields = fieldsToValidate(ctx.stream);
  const failCount = new Map<string, number>();
  const rawSamples = new Map<string, Set<string>>();
  let passingRows = 0;

  for (const row of sample) {
    // Run the real normalizer (it enforces the envelope null-check);
    // resolveField then re-derives each tracked field so a miss is attributed
    // to the exact field rather than blaming the whole row.
    //
    // H6: a row that THROWS here (e.g. a value whose String() throws) must not
    // escape validateFirstPoll and bubble out of pollOnce to the runner's
    // bare-log catch (which would hot-loop the first poll with no backoff). A
    // throwing row is simply a non-passing sample: it counts against the pass
    // fraction like any other bad row, so a systematically broken config still
    // halts as config_invalid instead of crashing.
    let event: CanonicalEventBase | null = null;
    try {
      event = normalizeRow(row, ctx);
    } catch {
      event = null;
    }
    let rowOk = event !== null;
    for (const f of fields) {
      const mapping = ctx.stream.map[f];
      let value: unknown = undefined;
      try {
        value = mapping === undefined ? undefined : resolveField(mapping, row);
      } catch {
        value = undefined;
      }
      if (value === undefined) {
        rowOk = false;
        failCount.set(f, (failCount.get(f) ?? 0) + 1);
        const samples = rawSamples.get(f) ?? new Set<string>();
        if (samples.size < MAX_RAW_SAMPLES_PER_FIELD) {
          let sampleStr = "<leer>";
          try {
            sampleStr = truncateRaw(rawValueForField(mapping, row));
          } catch {
            sampleStr = "<nicht darstellbar>";
          }
          samples.add(sampleStr);
        }
        rawSamples.set(f, samples);
      }
    }
    if (rowOk) passingRows++;
  }

  const issues: ConfigInvalidFieldIssue[] = [...failCount.entries()].map(
    ([field, failed]) => ({
      field,
      reason: reasonForField(ctx.stream.map[field], failed, total),
      sampleRawValues: [...(rawSamples.get(field) ?? [])],
    })
  );
  // Worst field first so the health message + UI lead with it.
  issues.sort(
    (a, b) => (failCount.get(b.field) ?? 0) - (failCount.get(a.field) ?? 0)
  );

  return {
    ok: passingRows / total >= MIN_PASS_FRACTION,
    sampleSize: total,
    passingRows,
    threshold: MIN_PASS_FRACTION,
    issues,
  };
}

function buildDriftReport(
  vendorId: string,
  streamKind: CanonicalEventKind,
  expected: string[],
  observed: string[]
): DriftReport {
  const exp = new Set(expected);
  const obs = new Set(observed);
  const missing = expected.filter((c) => !obs.has(c));
  const added = observed.filter((c) => !exp.has(c));
  return {
    vendorId,
    streamKind,
    expectedColumns: expected,
    observedColumns: observed,
    missing,
    added,
    detectedAt: new Date().toISOString(),
  };
}

export const _internal = {
  backoffMs,
  intervalMs,
  initialCursorValue,
  stringifyCursor,
  columnsMatch,
  cursorAdvances,
  compareCursor,
  buildDriftReport,
  isSchemaError,
  extractDriftColumns,
  validateFirstPoll,
  fieldsToValidate,
  keyTransformFields,
  MIN_PASS_FRACTION,
  FIRST_POLL_SAMPLE_SIZE,
  SCHEMA_DRIFT_SOURCE,
  MIN_FIRST_POLL_SAMPLE,
  REPROBE_MS,
  SCHEMA_ERROR_THRESHOLD,
  DST_LOOKBACK_MS,
};
