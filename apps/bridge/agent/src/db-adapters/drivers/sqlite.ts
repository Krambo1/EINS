import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
  StorageTypeSampler,
} from "../types.js";

/**
 * SQLite driver for the SQL-introspection framework.
 *
 * Backs Pixelmedics (hypothesis pending vendor confirmation) and any
 * small-vendor PVS that ships a file-based store. Also useful for
 * integration tests against a real engine without standing up a server.
 *
 * Wire library: `better-sqlite3` (already in the agent build for the
 * outbox + framework state). Bind syntax: SQLite supports both `?` and
 * `:name`; we use native named binds, so no SQL translation is needed.
 * The `host`/`port`/`username`/`password` connection fields are unused
 * for SQLite; only `database` matters and it's the absolute path to the
 * `.sqlite` / `.db` file.
 *
 * Concurrency: SQLite serialises writes via a global lock, but the
 * agent only reads (no writes against the vendor DB), so multiple
 * streams against the same file are fine.
 */

import BetterSqlite3 from "better-sqlite3";

type SqliteDb = InstanceType<typeof BetterSqlite3>;

/** better-sqlite3 is synchronous: busy_timeout blocks the whole event loop for
 *  its duration. Keep it tiny and wait ASYNCHRONOUSLY between retries so the
 *  other vendors' polls, the heartbeat and the outbox flush keep running while
 *  the PVS holds a write lock. */
const BUSY_TIMEOUT_MS = 250;
const BUSY_RETRIES = 20;
const BUSY_RETRY_DELAY_MS = 150;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isBusy(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return (
    e?.code === "SQLITE_BUSY" ||
    e?.code === "SQLITE_LOCKED" ||
    /database is locked|SQLITE_BUSY/i.test(String(e?.message ?? ""))
  );
}

export class SqliteDriver implements DbDriver, StorageTypeSampler {
  readonly engine = "sqlite" as const;

  private db: SqliteDb | null = null;
  private params: DbConnectionParams | null = null;
  private healthy = false;

  async connect(params: DbConnectionParams): Promise<void> {
    this.params = params;
    if (this.healthy && this.db) return;
    if (!params.database) {
      throw new Error(
        "sqlite: connect requires `database` (absolute file path to the .sqlite file)"
      );
    }
    // Read-only mode: prevents accidental writes against the vendor DB
    // even if a YAML config mis-declared a destructive statement.
    // fileMustExist=true so a typo in --db-database fails loudly rather
    // than creating an empty file.
    const db = new BetterSqlite3(params.database, {
      readonly: true,
      fileMustExist: true,
    });
    // busy_timeout is a per-connection setting and is safe on read-only handles.
    // journal_mode is owned by the writer (the vendor app); we don't set it here.
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.db = db;
    this.healthy = true;
  }

  async query(
    sql: string,
    params: Record<string, string | number | Date>
  ): Promise<QueryResult> {
    if (!this.db || !this.healthy) {
      await this.connect(this.params!);
    }
    // better-sqlite3 can only bind numbers, strings, bigints, buffers, and
    // null; a Date throws "TypeError: SQLite3 can only bind ...". The framework
    // binds a timestamp cursor as a Date (Phase 3) so the SERVER engines coerce
    // it natively; here we convert it back to ISO-8601 text before binding.
    //
    // The framework binds a SQLite timestamp cursor in the column's own storage
    // format (cursorFormat: iso_text / iso_t_text / epoch_s / epoch_ms / julian)
    // as a plain string or number, so a Date only reaches this driver from a
    // config that explicitly says cursorFormat: native. That fallback renders
    // ISO-8601 'T...Z' text, which compares correctly only against the same
    // lexical format.
    const bound = toBindableParams(params);
    for (let attempt = 0; ; attempt++) {
      try {
        const stmt = this.db!.prepare(sql);
        const rows = stmt.all(bound) as Array<Record<string, unknown>>;
        const columns = inferColumnsFromStatement(stmt, rows);
        return { columns, rows };
      } catch (err) {
        if (!isBusy(err) || attempt >= BUSY_RETRIES) throw err;
        await sleep(BUSY_RETRY_DELAY_MS);
      }
    }
  }

  /**
   * Storage class of the cursor column over the rows the stream query returns
   * (typeof()), by wrapping the query: { text: 40 } or { integer: 3, real: 1 }.
   * The framework uses it on the first poll to halt loudly when the column's
   * storage does not match cursorFormat (a TEXT cursor never compares correctly
   * against an epoch integer, and vice versa).
   */
  async sampleStorageTypes(
    sql: string,
    params: Record<string, string | number | Date>,
    column: string
  ): Promise<Record<string, number>> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) return {};
    const inner = sql.trim().replace(/;+\s*$/, "");
    const wrapped = `SELECT typeof("${column}") AS t, COUNT(*) AS n FROM (${inner}) GROUP BY t`;
    const res = await this.query(wrapped, params);
    const out: Record<string, number> = {};
    for (const r of res.rows) out[String(r.t)] = Number(r.n);
    return out;
  }

  async sampleTableStorageTypes(
    table: string,
    column: string
  ): Promise<Record<string, number>> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) return {};
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(table)) return {};
    // Bounded: the first 5000 rows are plenty to see the storage class.
    const wrapped = `SELECT typeof("${column}") AS t, COUNT(*) AS n FROM (SELECT "${column}" FROM ${table} LIMIT 5000) GROUP BY t`;
    const res = await this.query(wrapped, {});
    const out: Record<string, number> = {};
    for (const r of res.rows) out[String(r.t)] = Number(r.n);
    return out;
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // best-effort
      }
      this.db = null;
    }
    this.healthy = false;
  }

  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      if (!this.db || !this.healthy) {
        if (!this.params) return { ok: false, reason: "not configured" };
        await this.connect(this.params);
      }
      this.db!.prepare("SELECT 1 AS heartbeat").get();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

/**
 * Convert the framework's bind bag into types better-sqlite3 can bind. The
 * only non-bindable type the framework emits is Date (a timestamp cursor,
 * Phase 3), which we render as ISO-8601 text. Everything else passes through.
 */
function toBindableParams(
  params: Record<string, string | number | Date>
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

/**
 * better-sqlite3 exposes a `columns()` method on prepared statements
 * that have a `SELECT` — but only when the statement reads from a
 * registered table; PRAGMA-only or function-only statements return
 * undefined. We fall back to inspecting the first row's keys.
 */
function inferColumnsFromStatement(
  stmt: ReturnType<SqliteDb["prepare"]>,
  rows: Array<Record<string, unknown>>
): string[] {
  try {
    const cols = (stmt as unknown as {
      columns?: () => Array<{ name: string }>;
    }).columns?.();
    if (cols && cols.length > 0) return cols.map((c) => c.name);
  } catch {
    // Fallthrough.
  }
  if (rows.length === 0) return [];
  return Object.keys(rows[0]);
}
