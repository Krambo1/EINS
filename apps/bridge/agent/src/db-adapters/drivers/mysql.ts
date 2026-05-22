import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
} from "../types.js";

/**
 * MySQL / MariaDB driver for the SQL-introspection framework.
 *
 * Backs Indamed Medical Office, whose core practice data lives in a
 * local MariaDB instance (a separate Firebird store holds statistical
 * tables and is not needed for status derivation). The brief originally
 * assumed Postgres for Indamed; verified-corrected in
 * docs/section-11-verification.md.
 *
 * Wire library: `mysql2` (pure-JS bind layer, wire-compatible with
 * MariaDB on default protocol). Bind syntax: mysql2 supports both `?`
 * positional and `:name` via its `namedPlaceholders` option; we enable
 * named placeholders so YAML configs do not need translation.
 *
 * Read-only safety: we set `transaction_isolation` to READ COMMITTED on
 * connection and route each request through a single shared connection
 * (not a pool) so the vendor DB sees the lowest possible read load.
 */

type Mysql2Conn = {
  query<T = unknown>(
    options: { sql: string; values?: unknown; namedPlaceholders?: boolean },
    cb?: (err: Error | null, rows: T, fields?: Array<{ name: string }>) => void
  ): Promise<[T, Array<{ name: string }>]> | void;
  execute<T = unknown>(
    options: { sql: string; values?: unknown; namedPlaceholders?: boolean }
  ): Promise<[T, Array<{ name: string }>]>;
  ping(): Promise<void>;
  end(): Promise<void>;
};

type Mysql2Module = {
  createConnection(options: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    namedPlaceholders: boolean;
    dateStrings: boolean;
    timezone: string;
    multipleStatements: false;
    connectTimeout: number;
  }): Promise<Mysql2Conn>;
};

let cachedModule: Mysql2Module | null = null;

async function getModule(): Promise<Mysql2Module> {
  if (cachedModule) return cachedModule;
  const mod = (await import("mysql2/promise")) as unknown as Mysql2Module & {
    default?: Mysql2Module;
  };
  const resolved = mod.default ?? mod;
  if (!resolved || typeof resolved.createConnection !== "function") {
    throw new Error(
      "mysql2/promise module not available. Install dependency 'mysql2' to use the mysql driver."
    );
  }
  cachedModule = resolved;
  return resolved;
}

export class MysqlDriver implements DbDriver {
  readonly engine = "mysql" as const;

  private conn: Mysql2Conn | null = null;
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
    if (!params) throw new Error("mysql: connect called without params");
    const mod = await getModule();
    const conn = await mod.createConnection({
      host: params.host,
      port: params.port || 3306,
      user: params.username,
      password: params.password,
      database: params.database,
      namedPlaceholders: true,
      dateStrings: false,
      timezone: "Z",
      multipleStatements: false,
      connectTimeout: 10_000,
    });
    this.conn = conn;
    this.healthy = true;
  }

  async query(
    sql: string,
    params: Record<string, string | number>
  ): Promise<QueryResult> {
    if (!this.conn || !this.healthy) {
      await this.connect(this.params!);
    }
    const [rows, fields] = await this.conn!.execute<Array<Record<string, unknown>>>({
      sql,
      values: params,
      namedPlaceholders: true,
    });
    const columns = (fields ?? []).map((f) => f.name);
    return {
      columns: columns.length > 0 ? columns : inferColumnsFromRow(rows),
      rows: rows ?? [],
    };
  }

  async close(): Promise<void> {
    if (this.conn) {
      try {
        await this.conn.end();
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

function inferColumnsFromRow(rows: Array<Record<string, unknown>> | undefined): string[] {
  if (!rows || rows.length === 0) return [];
  return Object.keys(rows[0]);
}
