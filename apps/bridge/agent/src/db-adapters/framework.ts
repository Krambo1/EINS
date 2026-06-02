import type Database from "better-sqlite3";
import { enqueue, outboxConnection } from "../outbox.js";
import { normalizeRow, resolveField } from "./normalizer.js";
import {
  ALWAYS_REQUIRED,
  REQUIRED_FIELDS_BY_KIND,
} from "./vendor-config.js";
import type {
  CanonicalEventBase,
  CanonicalEventKind,
  ConfigInvalidFieldIssue,
  ConfigInvalidReport,
  DbDriver,
  DriftReport,
  FieldMapping,
  PendingHealthReport,
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
 * pushes nextRunAt out by exponential backoff (30s, 60s, 2m, 5m, 15m, 1h,
 * capped). FAIL_THRESHOLD consecutive failures set status='error' so the
 * portal can surface a health warning at Einstellungen → Integrationen.
 */

const FAIL_THRESHOLD = 5;
const SCHEMA_DRIFT_SOURCE = "db_adapter_framework";

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
    columnSnapshot: row.column_snapshot ? (JSON.parse(row.column_snapshot) as string[]) : null,
  };
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

  if (
    state.status === "schema_drift" ||
    state.status === "config_invalid" ||
    state.status === "disabled"
  ) {
    // All three are terminal halts requiring operator action (a config fix for
    // drift/config_invalid; a re-enable for disabled), cleared by resetting the
    // persisted db_adapter_state. Never re-poll: that is the silent retry loop
    // this stream-halt design avoids.
    return {
      emitted: 0,
      newCursor: state.cursor,
      driftDetected: state.status === "schema_drift",
      driftReport: null,
    };
  }

  const cursorBind = initialCursorValue(state.cursor, opts.stream);
  const queryParams: Record<string, string | number | Date> = {
    cursor: cursorBind,
    limit: opts.vendor.batchSize,
  };
  if (opts.stream.tiebreakColumn) {
    // Keyset tiebreak (finding 6). Bound as a number: tiebreakColumn must be an
    // integer column (the primary key is the natural choice). Number("") === 0
    // is the correct first-poll sentinel: on the first poll
    // `cursorColumn > :cursor` (epoch) already matches every real row, so the
    // tiebreak branch of the predicate is dormant and the 0 never excludes rows.
    queryParams.cursorTiebreak = Number(state.cursorTiebreak);
  }
  let result;
  try {
    result = await opts.driver.query(opts.stream.query, queryParams);
  } catch (err) {
    // A renamed/removed column or table makes the query THROW rather than
    // change the result-set shape, so the column-snapshot detector above
    // never sees it. Classify those errors as drift here so the stream halts
    // loudly and posts to /api/pvs/health, instead of retrying a permanent
    // condition forever and looking like a generic outage (review finding 2).
    if (isSchemaError(err)) {
      return recordSchemaError(state, opts, err, now);
    }
    return recordFailure(state, opts, (err as Error).message, now);
  }

  // ---- schema drift detection ------------------------------------------
  // A successful SELECT always projects at least one column, so an empty
  // result.columns means the driver returned no field metadata for THIS poll,
  // not that the table lost every column. Some drivers omit metadata on a
  // zero-row result, and a poll returning no new rows is the common steady
  // state. Treating that as "every column vanished" would raise false drift and
  // permanently halt a healthy revenue stream. So an empty column list carries
  // no drift signal: never baseline it, never compare against it. A genuine
  // rename still surfaces as a thrown undefined-column error (isSchemaError,
  // above), which is the real drift path for explicit-column SELECTs. Fall
  // through to row processing (a no-op for an empty result).
  let drift: DriftReport | null = null;
  if (result.columns.length === 0) {
    // No column information this poll; leave the snapshot untouched.
  } else if (state.columnSnapshot === null) {
    // First poll. Before baselining the column shape, validate the actual ROW
    // DATA against the YAML map (Phase 5). The column-snapshot detector only
    // catches a column that vanishes or is renamed; it cannot catch a column
    // that exists but holds the wrong data (a paid-status code the map doesn't
    // recognise, a mostly-NULL appointment id, a failing amount transform).
    // Baselining a config whose data does not normalise would silently ingest
    // corrupt revenue, so we refuse to baseline and halt the stream instead.
    const validation = validateFirstPoll(result.rows, {
      clinicId: opts.clinicId,
      vendor: opts.vendor,
      stream: opts.stream,
    });
    if (!validation.ok) {
      recordConfigInvalid({
        vendorId: opts.vendor.vendor,
        streamKind: opts.stream.kind,
        sampleSize: validation.sampleSize,
        passingRows: validation.passingRows,
        threshold: validation.threshold,
        issues: validation.issues,
        detectedAt: new Date().toISOString(),
      });
      state.status = "config_invalid";
      state.lastError = `config invalid: ${validation.passingRows}/${
        validation.sampleSize
      } sampled rows valid; fields=${validation.issues
        .map((i) => i.field)
        .join(",")}`;
      state.lastRunAt = now();
      // Leave columnSnapshot null on purpose: the config was never confirmed,
      // so when the stream is next run (after the operator fixes the config and
      // clears the halt) the first poll re-validates instead of treating
      // un-validated data as the trusted baseline.
      saveState(state);
      console.warn(
        `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: first-poll config validation failed (${validation.passingRows}/${validation.sampleSize} sampled rows valid); stream halted as config_invalid.`
      );
      return {
        emitted: 0,
        newCursor: state.cursor,
        driftDetected: false,
        driftReport: null,
      };
    }
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
  let maxTiebreak = state.cursorTiebreak;
  const tiebreakColumn = opts.stream.tiebreakColumn;
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
    if (rowCursor) {
      if (tiebreakColumn) {
        const rowTiebreak =
          row[tiebreakColumn] == null ? "" : String(row[tiebreakColumn]);
        if (
          cursorAdvances(
            rowCursor,
            rowTiebreak,
            maxCursor,
            maxTiebreak,
            opts.stream.cursorType
          )
        ) {
          maxCursor = rowCursor;
          maxTiebreak = rowTiebreak;
        }
      } else if (
        maxCursor === "" ||
        compareCursor(rowCursor, maxCursor, opts.stream.cursorType) > 0
      ) {
        maxCursor = rowCursor;
      }
    }
  }

  // ---- advance state ---------------------------------------------------
  state.cursor = maxCursor;
  state.cursorTiebreak = maxTiebreak;
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

/**
 * Record a query error classified as schema drift: halt the stream
 * (status='schema_drift'), persist a drift report so drift-publisher.ts POSTs
 * it to /api/pvs/health, and stop retrying a permanent condition every tick.
 */
function recordSchemaError(
  state: StreamState,
  opts: PollOptions,
  err: unknown,
  now: () => number
): PollOutcome {
  const report: DriftReport = {
    vendorId: opts.vendor.vendor,
    streamKind: opts.stream.kind,
    expectedColumns: state.columnSnapshot ?? [],
    observedColumns: [],
    missing: extractDriftColumns(err, state.columnSnapshot),
    added: [],
    detectedAt: new Date().toISOString(),
  };
  recordDrift(report);
  state.status = "schema_drift";
  state.lastError = `schema error (stream halted): ${(err as Error).message}`;
  state.lastRunAt = now();
  saveState(state);
  console.warn(
    `[db-framework] ${opts.vendor.vendor}/${opts.stream.kind}: query failed with a schema error; classified as drift and halted: ${(err as Error).message}`
  );
  return {
    emitted: 0,
    newCursor: state.cursor,
    driftDetected: true,
    driftReport: report,
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
  cursorType: StreamConfig["cursorType"]
): boolean {
  if (maxCursor === "") return true;
  const cmp = compareCursor(rowCursor, maxCursor, cursorType);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  return Number(rowTiebreak) > Number(maxTiebreak);
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
  const sample = rows.slice(0, FIRST_POLL_SAMPLE_SIZE);
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
    const event = normalizeRow(row, ctx);
    let rowOk = event !== null;
    for (const f of fields) {
      const mapping = ctx.stream.map[f];
      const value =
        mapping === undefined ? undefined : resolveField(mapping, row);
      if (value === undefined) {
        rowOk = false;
        failCount.set(f, (failCount.get(f) ?? 0) + 1);
        const samples = rawSamples.get(f) ?? new Set<string>();
        if (samples.size < MAX_RAW_SAMPLES_PER_FIELD) {
          samples.add(truncateRaw(rawValueForField(mapping, row)));
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
  MIN_PASS_FRACTION,
  FIRST_POLL_SAMPLE_SIZE,
  SCHEMA_DRIFT_SOURCE,
};
