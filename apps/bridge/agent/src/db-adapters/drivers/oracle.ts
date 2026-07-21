import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
} from "../types.js";

/**
 * Oracle driver for the SQL-introspection framework.
 *
 * Backs CGM M1 PRO's dominant install base, which runs on Oracle per CGM
 * SystemHaus product docs (the "Oracle SQL database" referenced as the M1
 * Pro standard). Some newer M1 Pro deployments run on SQL Server; that
 * path is covered by the MSSQL driver and the cgm-m1pro YAML.
 *
 * Wire library: `oracledb` v6+. We rely on the default **Thin** client
 * mode shipped with v6.0+, which speaks the Oracle Net protocol in pure
 * JS and removes the need to bundle the Oracle Instant Client binary
 * distribution with the agent. Thin mode supports Oracle Database 12.1
 * and later (including 18c, 19c, 21c, 23ai); legacy 11g installs would
 * need Thick mode + Instant Client, which we treat as a separate
 * installer flavor when first encountered.
 *
 * Bind syntax: Oracle uses `:name` natively, which matches the agent's
 * placeholder convention. No SQL translation is required; we pass binds
 * straight through as a values object.
 *
 * Read-only safety: a single connection per vendor (no pool) run with
 * autoCommit:false, plus a `SET TRANSACTION READ ONLY` issued at the start
 * of EVERY poll query (pentest M10). A write attempt inside the read-only
 * transaction raises ORA-01456 ("may not perform insert/delete/update
 * inside a READ ONLY transaction"). This is defense in depth over the
 * read-only user the Praxis IT person provisions per the AVV; see
 * apps/bridge/docs/onboarding-per-vendor/cgm-m1pro.md.
 *
 * Snapshot freshness (reliability review C3): `SET TRANSACTION READ ONLY`
 * pins TRANSACTION-LEVEL read consistency in Oracle: every SELECT inside
 * that transaction sees only data committed before the transaction began.
 * The original implementation issued it ONCE at connect and never
 * committed, so the data snapshot froze at connect time: every later poll
 * returned zero new rows forever while reporting healthy, until ORA-01555
 * eventually killed the session. The fix: each query() opens a FRESH
 * read-only transaction and COMMITs it in a finally block, so the next
 * poll sees everything committed since. (Committing a read-only
 * transaction writes nothing; it just ends the transaction.)
 */

/** node-oracledb call timeout (ms): bounds every round-trip (execute, ping)
 *  so a hung query or half-dead TCP connection surfaces as ORA-03136/DPI
 *  errors instead of wedging the poll loop forever (reliability review C4).
 *  Matches the 120s the Postgres and MSSQL drivers already use. */
const CALL_TIMEOUT_MS = 120_000;

type OracleConnection = {
  execute<T = Record<string, unknown>>(
    sql: string,
    binds: Record<string, unknown>,
    options: { outFormat: number; autoCommit: false }
  ): Promise<{
    rows: T[];
    metaData?: Array<{ name: string }>;
  }>;
  commit(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<void>;
  /** Milliseconds each round-trip may take; supported by node-oracledb v6
   *  Thin. Assigned (not passed at getConnection) per the oracledb API. */
  callTimeout?: number;
};

type OracleModule = {
  /** Constant: makes execute() return rows as objects keyed by column name. */
  OUT_FORMAT_OBJECT: number;
  getConnection(options: {
    user: string;
    password: string;
    connectString: string;
  }): Promise<OracleConnection>;
  /**
   * Optional: callers may invoke `initOracleClient()` to opt into Thick mode
   * (Oracle Instant Client). We deliberately do NOT call it; v6+ defaults
   * to Thin and that's our supported configuration.
   */
  initOracleClient?: (opts?: unknown) => void;
};

let cachedModule: OracleModule | null = null;

async function getModule(): Promise<OracleModule> {
  if (cachedModule) return cachedModule;
  const mod = (await import("oracledb")) as unknown as OracleModule & {
    default?: OracleModule;
  };
  const resolved = mod.default ?? mod;
  if (!resolved || typeof resolved.getConnection !== "function") {
    throw new Error(
      "oracledb module not available. Install dependency 'oracledb' to use the oracle driver."
    );
  }
  cachedModule = resolved;
  return resolved;
}

/**
 * Build an Easy Connect string for node-oracledb. The agent's
 * DbConnectionParams.database carries either the Oracle service name
 * (recommended; modern installs) or the SID (legacy). We always emit
 * `host:port/database`; Oracle resolves it as service name first, falling
 * back to SID-as-service for older listeners. Operators with bespoke
 * TNS aliases set `options.connectString` to override.
 */
export function buildConnectString(params: DbConnectionParams): string {
  const override = params.options?.connectString;
  if (typeof override === "string" && override.length > 0) return override;
  const port = params.port || 1521;
  const svc = params.database || "";
  return `${params.host}:${port}/${svc}`;
}

export class OracleDriver implements DbDriver {
  readonly engine = "oracle" as const;

  private conn: OracleConnection | null = null;
  private params: DbConnectionParams | null = null;
  private connecting: Promise<void> | null = null;
  private healthy = false;

  async connect(params: DbConnectionParams): Promise<void> {
    this.params = params;
    if (this.healthy && this.conn) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(): Promise<void> {
    const params = this.params;
    if (!params) throw new Error("oracle: connect called without params");
    // M-D5: release the previous connection before reconnecting. query() flips
    // `healthy` false (e.g. a commit that fails on a dropped socket) while
    // `conn` stays set, so a flapping LAN drives repeated doConnect() calls;
    // without closing the old handle each rebuild leaks a dead Oracle session
    // that accumulates over days. Best-effort and fire-and-forget so a hung
    // close() on a half-dead connection cannot stall the reconnect.
    if (this.conn) {
      const stale = this.conn;
      this.conn = null;
      void stale.close().catch(() => void 0);
    }
    const mod = await getModule();
    const conn = await mod.getConnection({
      user: params.username,
      password: params.password,
      connectString: buildConnectString(params),
    });
    // Bound every round-trip (C4). Assigned as a property per the oracledb
    // API; not a getConnection option.
    conn.callTimeout = CALL_TIMEOUT_MS;
    // NOTE: no SET TRANSACTION here. The read-only brake (pentest M10) is
    // per-query now: see query() and the C3 rationale in the header. A
    // connect-time SET TRANSACTION would pin the data snapshot to connect
    // time for the connection's whole life.
    this.conn = conn;
    this.healthy = true;
  }

  async query(
    sql: string,
    params: Record<string, string | number | Date>
  ): Promise<QueryResult> {
    if (!this.conn || !this.healthy) {
      await this.connect(this.params!);
    }
    // oracledb (Thin) binds a JS Date to a DATE / TIMESTAMP column via
    // OCIDateTime, ignoring NLS session formats. That is precisely why a
    // timestamp cursor is bound as a Date (framework Phase 3) rather than as
    // an ISO string, which Thin would reject against a native temporal column.
    const mod = await getModule();
    const conn = this.conn!;
    const execOpts = {
      outFormat: mod.OUT_FORMAT_OBJECT,
      autoCommit: false as const,
    };
    // C3 + M10: open a fresh READ ONLY transaction for THIS query. Being the
    // transaction's first statement, SET TRANSACTION is legal here because
    // the finally-commit below always ended the previous one. The SELECT
    // then reads a snapshot taken now (fresh data), and any write attempt
    // raises ORA-01456. outFormat is required by the typed signature but
    // irrelevant for a statement that returns no rows.
    await conn.execute("SET TRANSACTION READ ONLY", {}, execOpts);
    try {
      const result = await conn.execute<Record<string, unknown>>(
        sql,
        params,
        execOpts
      );
      // Oracle uppercases unquoted identifiers, so `... AS id` returns as `ID`
      // in both metaData and (under OUT_FORMAT_OBJECT) the row keys. Every vendor
      // YAML map: block addresses columns in lower case, the convention pg /
      // mysql / mssql preserve as-written and the Firebird driver already
      // normalises to via lowercase_keys. Without lower-casing here the
      // normaliser would look up `row["id"]` against a key spelled `"ID"`,
      // resolve nothing, drop every field, and the stream would emit zero events
      // and never advance its cursor. This bug is invisible to pg-mem and
      // SQLite (which keep the lower-case aliases as written); Phase 6's
      // real-engine harness (oracle.it.test.ts) is what surfaced it.
      const columns = (result.metaData ?? []).map((m) => m.name.toLowerCase());
      const rows = (result.rows ?? []).map(lowerCaseKeys);
      return {
        columns: columns.length > 0 ? columns : inferColumnsFromRow(rows),
        rows,
      };
    } finally {
      // End the read-only transaction so the NEXT poll's SET TRANSACTION
      // starts a fresh one (fresh snapshot). Runs on the error path too:
      // leaving the transaction open would both break the next SET
      // TRANSACTION (ORA-01453) and re-freeze the snapshot.
      try {
        await conn.commit();
      } catch {
        // Connection is unusable (e.g. dropped mid-query). Mark unhealthy so
        // the next query()/connect() rebuilds it; the original query error
        // (if any) stays the surfaced failure.
        this.healthy = false;
      }
    }
  }

  async close(): Promise<void> {
    if (this.conn) {
      try {
        await this.conn.close();
      } catch {
        // best-effort
      }
      this.conn = null;
    }
    this.healthy = false;
  }

  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      if (!this.conn || !this.healthy) {
        if (!this.params) return { ok: false, reason: "not configured" };
        await this.connect(this.params);
      }
      await this.conn!.ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

function inferColumnsFromRow(
  rows: Array<Record<string, unknown>> | undefined
): string[] {
  if (!rows || rows.length === 0) return [];
  return Object.keys(rows[0]);
}

/** Return a shallow copy of the row with every key lower-cased. See the
 *  rationale in OracleDriver.query(): Oracle reports unquoted aliases in
 *  upper case and the YAML map: blocks use lower case. */
function lowerCaseKeys(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    // L12: node-oracledb (Thin) fetches a NUMBER as a JS number by default.
    // An integer NUMBER id larger than 2^53 (a big surrogate key that a config
    // forgot to wrap in TO_CHAR) arrives here already rounded to the nearest
    // double: silent corruption of the id we key events on. A non-integer
    // NUMBER (a money amount like 100.5) is unaffected and passes through. Fail
    // loudly so the operator adds TO_CHAR(...) rather than ingest a mangled id.
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      !Number.isSafeInteger(value)
    ) {
      throw new Error(
        `oracle: column '${key.toLowerCase()}' returned a NUMBER (${value}) beyond JavaScript's safe integer range; wrap it in TO_CHAR(...) in the stream query to fetch it as a string`
      );
    }
    out[key.toLowerCase()] = value;
  }
  return out;
}
