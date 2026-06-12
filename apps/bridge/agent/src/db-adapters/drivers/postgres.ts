import type {
  DbDriver,
  DbConnectionParams,
  QueryResult,
} from "../types.js";

/**
 * PostgreSQL driver for the SQL-introspection framework.
 *
 * Backs Tomedo (port 5432, read-only account provisioned by Zollsoft 3rd-
 * Level Support per AVV-authorised request) and Indamed Medical Office
 * (also Postgres on some installs; verify per-site).
 *
 * Uses the `pg` client library. Single-connection model per vendor: streams
 * run sequentially against one connection rather than a pool, because a
 * Praxis-local DB doesn't need parallelism and read-only single-connection
 * load is the lowest possible risk profile for a vendor support team to
 * approve.
 *
 * Bind syntax: pg uses $1/$2/positional. We translate :name placeholders to
 * positional by scanning the SQL once per query; safe because the SQL is
 * declared in the YAML config, not user input.
 */

// Lazy-load `pg` so this module is import-safe in unit tests / environments
// without postgres-client native deps. We import the type-only interface
// directly; the runtime require happens inside `ensureClient()`.

type PgQueryResult = {
  rows: Array<Record<string, unknown>>;
  fields: Array<{ name: string }>;
};

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
  on(event: "error" | "end", listener: (...args: unknown[]) => void): void;
};

type PgClientCtor = new (config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean };
  statement_timeout?: number;
  query_timeout?: number;
  connectionTimeoutMillis?: number;
  application_name?: string;
}) => PgClient;

let cachedClientCtor: PgClientCtor | null = null;

async function getClientCtor(): Promise<PgClientCtor> {
  if (cachedClientCtor) return cachedClientCtor;
  const mod = (await import("pg")) as unknown as { Client: PgClientCtor };
  if (!mod || !mod.Client) {
    throw new Error(
      "pg module not available. Install dependency 'pg' to use the postgres driver."
    );
  }
  cachedClientCtor = mod.Client;
  return mod.Client;
}

export class PostgresDriver implements DbDriver {
  readonly engine = "postgres" as const;

  private client: PgClient | null = null;
  private params: DbConnectionParams | null = null;
  private connecting: Promise<void> | null = null;
  private healthy = false;

  async connect(params: DbConnectionParams): Promise<void> {
    this.params = params;
    if (this.healthy && this.client) return;
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
    if (!params) throw new Error("postgres: connect called without params");
    const Ctor = await getClientCtor();
    const ssl = params.options?.sslmode === "disable" ? undefined : undefined;
    // SSL note: a Praxis-local Tomedo Postgres almost never has SSL enabled,
    // and forcing it would just produce confusing handshake errors. We leave
    // ssl off by default; the YAML config can opt in via options.sslmode in
    // a future iteration.

    const client = new Ctor({
      host: params.host,
      port: params.port,
      database: params.database,
      user: params.username,
      password: params.password,
      ssl,
      // Statement and connect timeouts. Keep generous so initial-sync of a
      // patient table on a slow Mac mini doesn't fail spuriously.
      statement_timeout: 120_000,
      query_timeout: 120_000,
      connectionTimeoutMillis: 10_000,
      application_name: "eins-agent-db-read",
    });

    client.on("error", (err) => {
      console.error("[postgres] client error:", err);
      this.healthy = false;
    });
    client.on("end", () => {
      this.healthy = false;
    });

    await client.connect();
    // Read-only brake: the agent only ever SELECTs from the Praxis DB. Force
    // the session read-only so a malformed or hostile YAML-config query can
    // never mutate the practice's database — independent of (and in addition
    // to) the provisioned account's grants (pentest M10).
    await client.query("SET default_transaction_read_only = on", []);
    this.client = client;
    this.healthy = true;
  }

  async query(
    sql: string,
    params: Record<string, string | number | Date>
  ): Promise<QueryResult> {
    if (!this.client || !this.healthy) {
      await this.connect(this.params!);
    }
    // A Date param flows straight through to `pg`, which serialises it to a
    // Postgres timestamp on the wire. Timestamp cursors are bound as Date
    // (framework Phase 3); strings/numbers pass through unchanged.
    const { translated, values } = translateNamedToPositional(sql, params);
    const result = await this.client!.query(translated, values);
    return {
      columns: result.fields.map((f) => f.name),
      rows: result.rows,
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // Swallow: close() is best-effort.
      }
      this.client = null;
    }
    this.healthy = false;
  }

  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      if (!this.client || !this.healthy) {
        if (!this.params) return { ok: false, reason: "not configured" };
        await this.connect(this.params);
      }
      await this.client!.query("SELECT 1", []);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

/**
 * Translate `:name` placeholders to PostgreSQL's `$1` / `$2` form. The same
 * name can appear multiple times in the SQL; we emit one `$N` per occurrence
 * (postgres is happy to bind the same value many times via separate slots).
 *
 * The negative lookbehind on `:` skips Postgres `::cast` syntax (e.g.
 * `id::text`) so the `:text` half is not mistaken for a placeholder.
 *
 * SQL strings are author-controlled (vendor YAML configs in our own repo),
 * so we don't need to defend against pg keyword collisions or quoted-string
 * `:name`-like substrings. If that ever changes (user-supplied SQL), this
 * needs a tokenising parser.
 */
export function translateNamedToPositional(
  sql: string,
  params: Record<string, string | number | Date>
): { translated: string; values: unknown[] } {
  const values: unknown[] = [];
  const translated = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
    if (!(name in params)) {
      throw new Error(`postgres: SQL placeholder :${name} has no bound value`);
    }
    values.push(params[name]);
    return `$${values.length}`;
  });
  return { translated, values };
}
