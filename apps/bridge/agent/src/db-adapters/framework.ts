import Database from "better-sqlite3";
import { outboxPath } from "../config.js";
import { enqueue } from "../outbox.js";
import { normalizeRow } from "./normalizer.js";
import type {
  CanonicalEventBase,
  CanonicalEventKind,
  DbDriver,
  DriftReport,
  StreamConfig,
  StreamState,
  StreamStatus,
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
 * pushes nextRunAt out by exponential backoff (30s, 60s, 2m, 5m, 15m, 1h,
 * capped). FAIL_THRESHOLD consecutive failures set status='error' so the
 * portal can surface a health warning at Einstellungen → Integrationen.
 */

const FAIL_THRESHOLD = 5;
const SCHEMA_DRIFT_SOURCE = "db_adapter_framework";

let dbCached: Database.Database | null = null;

function db(): Database.Database {
  if (!dbCached) {
    dbCached = new Database(outboxPath());
    dbCached.exec(`
      CREATE TABLE IF NOT EXISTS db_adapter_state (
        vendor_id TEXT NOT NULL,
        stream_kind TEXT NOT NULL,
        cursor TEXT NOT NULL DEFAULT '',
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
        reported_to_portal INTEGER NOT NULL DEFAULT 0
      );
    `);
  }
  return dbCached;
}

/** Test-only hook: swap the SQLite backend for an in-memory copy. */
export function _setStateDbForTesting(handle: Database.Database | null): void {
  dbCached = handle;
}

export function loadState(
  vendorId: string,
  streamKind: CanonicalEventKind
): StreamState {
  const row = db()
    .prepare(
      `SELECT vendor_id, stream_kind, cursor, status, last_run_at, last_error,
              consecutive_failures, next_run_at, column_snapshot
       FROM db_adapter_state
       WHERE vendor_id = ? AND stream_kind = ?`
    )
    .get(vendorId, streamKind) as
    | {
        vendor_id: string;
        stream_kind: string;
        cursor: string;
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
    status: row.status as StreamStatus,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    nextRunAt: row.next_run_at,
    columnSnapshot: row.column_snapshot ? (JSON.parse(row.column_snapshot) as string[]) : null,
  };
}

export function saveState(state: StreamState): void {
  db()
    .prepare(
      `INSERT INTO db_adapter_state
         (vendor_id, stream_kind, cursor, status, last_run_at, last_error,
          consecutive_failures, next_run_at, column_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vendor_id, stream_kind) DO UPDATE SET
         cursor = excluded.cursor,
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
        (vendor_id, stream_kind, expected, observed, missing, added, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      report.vendorId,
      report.streamKind,
      JSON.stringify(report.expectedColumns),
      JSON.stringify(report.observedColumns),
      JSON.stringify(report.missing),
      JSON.stringify(report.added),
      new Date(report.detectedAt).getTime()
    );
}

export function pendingDriftReports(): Array<DriftReport & { id: number }> {
  const rows = db()
    .prepare(
      `SELECT id, vendor_id, stream_kind, expected, observed, missing, added, detected_at
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
  }));
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

export async function pollOnce(opts: PollOptions): Promise<PollOutcome> {
  const now = opts.now ?? Date.now;
  const state = loadState(opts.vendor.vendor, opts.stream.kind);

  if (state.status === "schema_drift" || state.status === "disabled") {
    return {
      emitted: 0,
      newCursor: state.cursor,
      driftDetected: state.status === "schema_drift",
      driftReport: null,
    };
  }

  const cursorBind = initialCursorValue(state.cursor, opts.stream);
  let result;
  try {
    result = await opts.driver.query(opts.stream.query, {
      cursor: cursorBind,
      limit: opts.vendor.batchSize,
    });
  } catch (err) {
    return recordFailure(state, opts, (err as Error).message, now);
  }

  // ---- schema drift detection ------------------------------------------
  let drift: DriftReport | null = null;
  if (state.columnSnapshot === null) {
    state.columnSnapshot = result.columns;
  } else if (!columnsMatch(state.columnSnapshot, result.columns)) {
    drift = buildDriftReport(opts.vendor.vendor, opts.stream.kind, state.columnSnapshot, result.columns);
    recordDrift(drift);
    state.status = "schema_drift";
    state.lastError = `schema drift: missing=${drift.missing.join(",")} added=${drift.added.join(",")}`;
    state.lastRunAt = now();
    saveState(state);
    return {
      emitted: 0,
      newCursor: state.cursor,
      driftDetected: true,
      driftReport: drift,
    };
  }

  // ---- normalise + enqueue ---------------------------------------------
  let emitted = 0;
  let maxCursor = state.cursor;
  for (const row of result.rows) {
    const event = normalizeRow(row, {
      clinicId: opts.clinicId,
      vendor: opts.vendor,
      stream: opts.stream,
    });
    if (!event) continue;
    try {
      const payload = JSON.stringify(event);
      if (opts.sink) {
        opts.sink(event);
      } else {
        enqueue(payload, event.pvsExternalEventId);
      }
      emitted++;
    } catch (err) {
      console.error(
        `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: enqueue failed:`,
        err
      );
    }
    const rowCursor = stringifyCursor(row[opts.stream.cursorColumn], opts.stream);
    if (rowCursor && (maxCursor === "" || rowCursor > maxCursor)) {
      maxCursor = rowCursor;
    }
  }

  // ---- advance state ---------------------------------------------------
  state.cursor = maxCursor;
  state.status = "idle";
  state.lastError = null;
  state.lastRunAt = now();
  state.consecutiveFailures = 0;
  state.nextRunAt = now() + intervalMs(opts.vendor, opts.stream);
  saveState(state);

  return {
    emitted,
    newCursor: maxCursor,
    driftDetected: false,
    driftReport: null,
  };
}

// ---------- helpers -------------------------------------------------------

function recordFailure(
  state: StreamState,
  opts: PollOptions,
  reason: string,
  now: () => number
): PollOutcome {
  state.consecutiveFailures += 1;
  state.lastError = reason;
  state.lastRunAt = now();
  state.status = state.consecutiveFailures >= FAIL_THRESHOLD ? "error" : "idle";
  state.nextRunAt = now() + backoffMs(state.consecutiveFailures);
  saveState(state);
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

function backoffMs(n: number): number {
  return Math.min(60 * 60_000, 30_000 * Math.pow(2, n - 1));
}

function intervalMs(vendor: VendorConfig, stream: StreamConfig): number {
  const seconds = stream.intervalSeconds ?? vendor.defaultIntervalSeconds;
  return Math.max(1_000, seconds * 1_000);
}

function initialCursorValue(
  cursor: string,
  stream: StreamConfig
): string | number {
  if (cursor === "") {
    switch (stream.cursorType) {
      case "timestamp":
        return "1970-01-01T00:00:00.000Z";
      case "integer":
        return 0;
      case "string":
        return "";
    }
  }
  if (stream.cursorType === "integer") return Number(cursor);
  return cursor;
}

function stringifyCursor(value: unknown, stream: StreamConfig): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
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
  buildDriftReport,
  SCHEMA_DRIFT_SOURCE,
};
