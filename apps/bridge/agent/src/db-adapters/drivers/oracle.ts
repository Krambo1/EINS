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
 * Read-only safety: a single connection per vendor (no pool), and we
 * leave the session at the database's default isolation level. The
 * Praxis IT person provisions a read-only user with SELECT-only grants
 * per the AVV; see apps/bridge/docs/onboarding-per-vendor/cgm-m1pro.md.
 */

type OracleConnection = {
  execute<T = Record<string, unknown>>(
    sql: string,
    binds: Record<string, unknown>,
    options: { outFormat: number; autoCommit: false }
  ): Promise<{
    rows: T[];
    metaData?: Array<{ name: string }>;
  }>;
  close(): Promise<void>;
  ping(): Promise<void>;
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
    const mod = await getModule();
    const conn = await mod.getConnection({
      user: params.username,
      password: params.password,
      connectString: buildConnectString(params),
    });
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
    const result = await this.conn!.execute<Record<string, unknown>>(
      sql,
      params,
      { outFormat: mod.OUT_FORMAT_OBJECT, autoCommit: false }
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
  for (const key of Object.keys(row)) out[key.toLowerCase()] = row[key];
  return out;
}
