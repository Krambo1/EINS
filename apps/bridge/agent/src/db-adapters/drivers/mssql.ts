import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
} from "../types.js";

/**
 * Microsoft SQL Server driver for the SQL-introspection framework.
 *
 * Backs CGM M1 Pro on newer SQL-Server-based installs and acts as a
 * fallback for any Praxis whose PVS exposes data through MSSQL. The
 * dominant CGM M1 Pro install base is Oracle; that path lives in the
 * sibling OracleDriver (drivers/oracle.ts) and is wired through the
 * cgm-m1pro-oracle.yaml config.
 *
 * Wire library: the `mssql` npm package (tedious driver under the hood).
 * Bind syntax: MSSQL uses `@name` named parameters; we translate the
 * agent's `:name` placeholders to `@name` and pass values via the
 * Request.input() API. Type inference is delegated to mssql; the YAML
 * configs only bind string / number, so the default coercion is fine.
 */

type MssqlPool = {
  connect(): Promise<void>;
  close(): Promise<void>;
  request(): MssqlRequest;
};

type MssqlRequest = {
  /** Two-arg form binds with mssql's default type inference; the three-arg
   *  form pins an explicit SQL type (M-D8: DateTime2 for a Date cursor). */
  input(name: string, value: unknown): MssqlRequest;
  input(name: string, type: unknown, value: unknown): MssqlRequest;
  query(text: string): Promise<{
    recordset: Array<Record<string, unknown>> & {
      columns?: Record<string, { name?: string; index?: number }>;
    };
  }>;
};

type MssqlConfig = {
  user: string;
  password: string;
  server: string;
  port: number;
  database: string;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    enableArithAbort: boolean;
  };
  connectionTimeout: number;
  requestTimeout: number;
  pool: { max: number; min: number; idleTimeoutMillis: number };
};

type MssqlModule = {
  ConnectionPool: new (config: MssqlConfig) => MssqlPool;
  /** The mssql DateTime2 type factory / marker. Passed to Request.input() to
   *  bind a Date at full precision instead of legacy datetime (M-D8). */
  DateTime2: unknown;
};

let cachedModule: MssqlModule | null = null;

async function getModule(): Promise<MssqlModule> {
  if (cachedModule) return cachedModule;
  const mod = (await import("mssql")) as unknown as MssqlModule & {
    default?: MssqlModule;
  };
  const resolved = mod.default ?? mod;
  if (!resolved || typeof resolved.ConnectionPool !== "function") {
    throw new Error(
      "mssql module not available. Install dependency 'mssql' to use the mssql driver."
    );
  }
  cachedModule = resolved;
  return resolved;
}

export class MssqlDriver implements DbDriver {
  readonly engine = "mssql" as const;

  private pool: MssqlPool | null = null;
  private params: DbConnectionParams | null = null;
  private connecting: Promise<void> | null = null;
  private healthy = false;

  async connect(params: DbConnectionParams): Promise<void> {
    this.params = params;
    if (this.healthy && this.pool) return;
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
    if (!params) throw new Error("mssql: connect called without params");
    // M-D5: release the previous pool before reconnecting. A flapping LAN drives
    // repeated doConnect() calls (query() reconnects whenever `healthy` is false
    // while `pool` is still set); without closing the old pool each rebuild
    // leaks dead tedious sockets that accumulate on the Praxis SQL Server over
    // days. Best-effort and fire-and-forget so a hung close() cannot stall the
    // reconnect.
    if (this.pool) {
      const stale = this.pool;
      this.pool = null;
      void stale.close().catch(() => void 0);
    }
    const mod = await getModule();
    // Praxis-local SQL Server is almost never on a trusted CA; encrypt
    // remains on (TLS over TCP), but we trust whatever cert it presents.
    // The wire stays inside the Praxis LAN.
    const encrypt = params.options?.encrypt !== false;
    const trustServerCertificate =
      params.options?.trustServerCertificate !== false;

    const pool = new mod.ConnectionPool({
      user: params.username,
      password: params.password,
      server: params.host,
      port: params.port || 1433,
      database: params.database,
      options: {
        encrypt,
        trustServerCertificate,
        enableArithAbort: true,
      },
      connectionTimeout: 10_000,
      requestTimeout: 120_000,
      pool: { max: 2, min: 1, idleTimeoutMillis: 30_000 },
    });

    await pool.connect();
    // Read-only safety (pentest M10): SQL Server has no session-level
    // read-only access mode (`ApplicationIntent=ReadOnly` only routes to an
    // Availability-Group read replica, which a Praxis-local install does not
    // have). The read-only guarantee therefore rests on the SELECT-only login
    // the Praxis IT person provisions per the AVV, plus the fact that every
    // statement is author-controlled YAML in our own repo (never user input).
    // No safe session directive to add here.
    this.pool = pool;
    this.healthy = true;
  }

  async query(
    sql: string,
    params: Record<string, string | number | Date>
  ): Promise<QueryResult> {
    if (!this.pool || !this.healthy) {
      await this.connect(this.params!);
    }
    // M-D8: bind a Date cursor as DateTime2 (100ns grain) rather than letting
    // mssql/tedious infer legacy `datetime`, whose 3.33ms rounding can push the
    // bound value off the exact stored timestamp so the keyset equality arm
    // (`modified_at = :cursor AND id > :cursorTiebreak`) misses rows in a
    // sub-3ms same-timestamp cluster at the batch boundary, silently skipping
    // them. Strings and numbers keep mssql's default inference.
    const mod = await getModule();
    const { translated, bindings } = translateNamedToAt(sql, params);
    const req = this.pool!.request();
    for (const [name, value] of bindings) {
      if (value instanceof Date) {
        req.input(name, mod.DateTime2, value);
      } else {
        req.input(name, value);
      }
    }
    const result = await req.query(translated);
    const columns = extractColumns(result.recordset);
    return { columns, rows: result.recordset ?? [] };
  }

  async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
      } catch {
        // best-effort
      }
      this.pool = null;
    }
    this.healthy = false;
  }

  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      if (!this.pool || !this.healthy) {
        if (!this.params) return { ok: false, reason: "not configured" };
        await this.connect(this.params);
      }
      await this.pool!.request().query("SELECT 1 AS heartbeat");
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

/**
 * Translate `:name` → `@name`. We dedupe bindings (the same `:cursor`
 * appearing twice is bound once via `.input("cursor", ...)`) because
 * mssql rejects repeated `.input()` for the same parameter name.
 */
export function translateNamedToAt(
  sql: string,
  params: Record<string, string | number | Date>
): { translated: string; bindings: Array<[string, unknown]> } {
  const seen = new Set<string>();
  const bindings: Array<[string, unknown]> = [];
  const translated = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
    if (!(name in params)) {
      throw new Error(`mssql: SQL placeholder :${name} has no bound value`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      bindings.push([name, params[name]]);
    }
    return `@${name}`;
  });
  return { translated, bindings };
}

function extractColumns(
  recordset: Array<Record<string, unknown>> & {
    columns?: Record<string, { name?: string; index?: number }>;
  } | undefined
): string[] {
  if (!recordset) return [];
  const cols = recordset.columns;
  if (cols) {
    const entries = Object.entries(cols).map(([key, meta]) => ({
      name: meta.name ?? key,
      index: meta.index ?? 0,
    }));
    entries.sort((a, b) => a.index - b.index);
    return entries.map((e) => e.name);
  }
  if (recordset.length === 0) return [];
  return Object.keys(recordset[0]);
}
