/**
 * Shared type surface for the SQL-introspection framework.
 *
 * The framework reads from a Praxis's local PVS database via a driver that
 * implements DbDriver. Streams declared in the vendor YAML config are polled
 * incrementally; rows are normalised into CanonicalEvents that match the
 * portal's PvsEventSchema (mirrored in apps/bridge/src/canonical/types.ts).
 *
 * Kept agent-local to keep the binary buildable without monorepo deps.
 */

// ---------- canonical events (mirror of apps/bridge/src/canonical/types) --

// BridgeSource / CanonicalEventKind / Currency are GENERATED from the single
// source of truth (apps/bridge/src/canonical/schema-source.ts) into
// ./generated-canonical.ts and re-exported here so every existing
// `import ... from "./types.js"` keeps working. Do not re-declare them inline:
// that is exactly the drift this codegen exists to prevent.
export type {
  BridgeSource,
  CanonicalEventKind,
  Currency,
} from "./generated-canonical.js";
import type { BridgeSource, CanonicalEventKind } from "./generated-canonical.js";

export interface CanonicalEventBase {
  kind: CanonicalEventKind;
  clinicId: string;
  bridgeSource: BridgeSource;
  pvsExternalEventId: string;
  occurredAt: string;
  [k: string]: unknown;
}

// ---------- driver interface ---------------------------------------------

export interface ColumnValue {
  /** Raw column value as the driver returned it. Drivers MUST coerce DB-side
   *  timestamps to ISO-8601 strings so the normaliser can treat all engines
   *  uniformly; everything else passes through. */
  value: unknown;
}

export interface QueryResult {
  /** Ordered list of column names as returned by the result set. Used for
   *  schema-drift detection. */
  columns: string[];
  /** One row = a map of column-name → value. Order within the row is
   *  irrelevant; the normaliser addresses columns by name. */
  rows: Record<string, unknown>[];
}

export interface DbConnectionParams {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** Driver-specific extras (sslmode, connectTimeout, etc). The framework
   *  passes this through opaquely; the driver reads what it understands and
   *  ignores the rest. */
  options?: Record<string, unknown>;
}

export interface DbDriver {
  /** Engine name. Must match `driver:` in the vendor YAML.
   *
   *  The brief enumerated postgres|firebird|mssql|sqlite; mysql was added
   *  in Phase 2 after open-question verification revealed Indamed Medical
   *  Office uses MariaDB (wire-compatible with MySQL) rather than the
   *  PostgreSQL the brief assumed. Oracle was added in 2026-05-21 to cover
   *  CGM M1 PRO's dominant Oracle install base; we use node-oracledb v6+
   *  Thin mode so the agent stays a single self-contained binary (no
   *  Oracle Instant Client distribution). See docs/section-11-verification.md
   *  and docs/troubleshooting.md.
   */
  readonly engine:
    | "postgres"
    | "firebird"
    | "mssql"
    | "sqlite"
    | "mysql"
    | "oracle";

  /** Establish (or re-use a healthy) connection. Idempotent: calling twice
   *  is a no-op unless the prior connection went bad, in which case it
   *  reconnects. */
  connect(params: DbConnectionParams): Promise<void>;

  /** Run a parametrised SQL statement. Parameters are bound by name
   *  (`:cursor`, `:limit`, ...); the driver translates to its native bind
   *  syntax. Supported bind types: string, number, and Date.
   *
   *  A timestamp cursor is bound as a native `Date` (Phase 3) so each engine
   *  coerces it to the column's temporal type. Binding an ISO-8601 'Z' string
   *  only ever worked on Postgres; Firebird, Oracle, MSSQL and MySQL throw or
   *  match nothing against a native TIMESTAMP on the first poll. The server
   *  drivers (pg, node-firebird, oracledb Thin, mssql/tedious, mysql2) accept
   *  a Date directly; the SQLite driver converts it back to ISO text because
   *  better-sqlite3 cannot bind a Date. */
  query(
    sql: string,
    params: Record<string, string | number | Date>
  ): Promise<QueryResult>;

  /** Close the underlying connection / pool. Called on agent shutdown and
   *  on schema-drift halt for the entire vendor. */
  close(): Promise<void>;

  /** Quick liveness probe. Returns ok=true if a trivial query succeeds.
   *  Used by the runner's tick loop to decide whether to reconnect. */
  healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

// ---------- normaliser context -------------------------------------------

export type TransformName =
  /** Tomedo / generic German gender values to canonical "f"|"m"|"d"|"x" */
  | "gender"
  /** German / English appointment-status text to canonical newStatus */
  | "appointmentStatus"
  /** parseAmountToCents-style: "12,50 EUR" → 1250 */
  | "amountToCents"
  /** like amountToCents but the absolute value, for refund / Storno rows whose
   *  amount may be stored negative; refundedAmountCents must be a positive
   *  magnitude (the portal Zod rejects negatives) */
  | "absAmountToCents"
  /** value already in integer cents: pass through as Number */
  | "integerCents"
  /** ISO 8601 datetime: coerce JS Date or string to ISO string */
  | "isoDateTime"
  /** YYYY-MM-DD: strip time portion */
  | "isoDate"
  /** Lowercase trimmed string, undefined when empty */
  | "lowerEmail"
  /** Trim+truncate phone */
  | "phone"
  /** trim + cap at 4000 chars */
  | "bemerkung";

export type FieldMapping =
  /** Direct column reference: just the column name. */
  | string
  /** Object form for transforms and templates. */
  | {
      /** Column name to read from. Required for transform / from forms. */
      from?: string;
      /** Template string with `{column_name}` placeholders. Mutually
       *  exclusive with `from`. */
      template?: string;
      /** Built-in transform applied to the resolved value. */
      transform?: TransformName;
      /** Static literal (e.g. for currency: "EUR"). When set, takes
       *  precedence over from/template. */
      literal?: string | number;
    };

/** The map: block for a single stream in vendor YAML. Keys are the canonical
 *  event field names (pvsPatientId, scheduledAt, ...); values describe how to
 *  derive them from the SQL row. */
export type StreamFieldMap = Record<string, FieldMapping>;

export interface StreamConfig {
  kind: CanonicalEventKind;
  /** Column from the SELECT that monotonically increases. Used as :cursor
   *  binding in the query and as the new cursor value after a successful
   *  poll (max of cursorColumn across the returned rows). */
  cursorColumn: string;
  cursorType: "timestamp" | "integer" | "string";
  /** SQL with `:cursor` and `:limit` placeholders (plus `:cursorTiebreak`
   *  when tiebreakColumn is set). Drivers translate placeholders to native
   *  bind syntax. */
  query: string;
  /** Field → column / transform / template. */
  map: StreamFieldMap;
  /** Optional tiebreak column for keyset pagination (review finding 6).
   *
   *  Without it, `WHERE cursorColumn > :cursor ORDER BY cursorColumn LIMIT n`
   *  silently SKIPS rows whenever more than `batchSize` rows share one
   *  cursorColumn value at a batch boundary (a bulk import / mass update sets
   *  an identical modified_at on many rows). The cursor jumps past that whole
   *  timestamp and the overflow is never read again.
   *
   *  When set, the framework also binds `:cursorTiebreak` and advances a
   *  composite (cursorColumn, tiebreakColumn) cursor. The query MUST express
   *  the keyset predicate and a matching two-column ORDER BY, e.g.
   *    WHERE (modified_at > :cursor
   *           OR (modified_at = :cursor AND id > :cursorTiebreak))
   *    ORDER BY modified_at ASC, id ASC
   *    LIMIT :limit
   *  The tiebreak column must be unique within a single cursorColumn value
   *  (a primary key is the natural choice). Streams without it keep the plain
   *  single-column behaviour, so existing configs are unaffected. */
  tiebreakColumn?: string;
  /** Optional poll cadence override. Default per-vendor at the file level. */
  intervalSeconds?: number;
}

export interface VendorConfig {
  /** Stable id; used as `(vendorId, streamKind)` cursor key. Same as the
   *  YAML filename minus extension by convention. */
  vendor: string;
  driver: DbDriver["engine"];
  /** Bridge source the agent will stamp on emitted events. Must match the
   *  pvs_link.vendor on the portal side or the route returns
   *  vendor_mismatch. */
  bridgeSource: BridgeSource;
  connection: {
    credentialId: string;
    port?: number;
    database?: string;
    options?: Record<string, unknown>;
  };
  /** Default cadence for streams that don't override. */
  defaultIntervalSeconds: number;
  /** Per-stream batch size in the LIMIT clause. */
  batchSize: number;
  streams: StreamConfig[];
}

// ---------- runner state -------------------------------------------------

export type StreamStatus =
  | "idle"
  | "running"
  | "error"
  | "schema_drift"
  // First-poll value validation (Phase 5) found the returned data does not
  // match the YAML map (wrong status codes, mostly-null required column, a
  // failing transform). Halts the stream exactly like schema_drift: a terminal
  // state cleared only by an operator config fix, never a silent retry.
  | "config_invalid"
  | "disabled";

export interface StreamState {
  vendorId: string;
  streamKind: CanonicalEventKind;
  cursor: string;
  /** Composite-cursor tiebreak value for keyset pagination (review finding
   *  6). Empty string unless the stream sets tiebreakColumn. Persisted
   *  alongside `cursor` and bound as :cursorTiebreak on the next poll. */
  cursorTiebreak: string;
  status: StreamStatus;
  lastRunAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextRunAt: number;
  /** JSON array of column names captured on the first successful poll.
   *  Compared against every subsequent poll for drift detection. */
  columnSnapshot: string[] | null;
}

export interface DriftReport {
  vendorId: string;
  streamKind: CanonicalEventKind;
  expectedColumns: string[];
  observedColumns: string[];
  missing: string[];
  added: string[];
  detectedAt: string;
}

// ---------- first-poll value validation (Phase 5) ------------------------

/**
 * One canonical event field that failed first-poll value validation. The
 * schema-drift detector only catches a column that disappears or is renamed
 * (the SELECT throws); it cannot catch a column that still exists but holds
 * the WRONG data (a paid-status code the map doesn't recognise, a mostly-NULL
 * appointment-id column, a gross amount where the map expects net). This is
 * how that silent corruption is named back to the Praxis.
 */
export interface ConfigInvalidFieldIssue {
  /** Canonical event field that failed (e.g. "newStatus", "amountCents"). */
  field: string;
  /** Human-readable cause: a required value missing, or a transform that
   *  yielded undefined for the sampled rows. German, Sie-form. */
  reason: string;
  /** A few raw source-column values from the sample, for diagnosis. Truncated
   *  and de-duplicated; never the full row. */
  sampleRawValues: string[];
}

/**
 * Verdict of the first-poll value validator. Persisted to db_adapter_drift
 * (report_kind='config_invalid') and posted to /api/pvs/health as a
 * `config_invalid` event when `ok` is false.
 */
export interface ConfigInvalidReport {
  vendorId: string;
  streamKind: CanonicalEventKind;
  /** Rows sampled on the first poll (capped at the sample size). */
  sampleSize: number;
  /** Rows for which every required field AND key transform resolved. */
  passingRows: number;
  /** Minimum pass fraction required to baseline the config (0..1). */
  threshold: number;
  issues: ConfigInvalidFieldIssue[];
  detectedAt: string;
}

/**
 * A pending health report drained by drift-publisher.ts: either a column
 * schema-drift report (the original) or a first-poll config-invalid report
 * (Phase 5). Both ride the same db_adapter_drift queue, HMAC posting, dedup
 * and retry machinery; only the posted `eventKind` and `detail` differ.
 */
export interface PendingHealthReport extends DriftReport {
  id: number;
  reportKind: "schema_drift" | "config_invalid";
  /** Present only when reportKind === 'config_invalid'. */
  configInvalidDetail: {
    sampleSize: number;
    passingRows: number;
    threshold: number;
    issues: ConfigInvalidFieldIssue[];
  } | null;
}
