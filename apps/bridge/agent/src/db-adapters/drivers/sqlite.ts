import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
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

export class SqliteDriver implements DbDriver {
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
    db.pragma("busy_timeout = 5000");
    this.db = db;
    this.healthy = true;
  }

  async query(
    sql: string,
    params: Record<string, string | number>
  ): Promise<QueryResult> {
    if (!this.db || !this.healthy) {
      await this.connect(this.params!);
    }
    const stmt = this.db!.prepare(sql);
    // better-sqlite3 expects either positional or a named-object;
    // pass the bag straight through since our YAML configs use `:name`.
    const rows = stmt.all(params as unknown as Record<string, unknown>) as Array<
      Record<string, unknown>
    >;
    const columns = inferColumnsFromStatement(stmt, rows);
    return { columns, rows };
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
