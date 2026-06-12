import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
} from "../types.js";

/**
 * Firebird driver for the SQL-introspection framework.
 *
 * Backs medatixx (x.isynet / x.concept / x.comfort), CGM Turbomed, and
 * Quincy (Frey ADV). All three are Windows-server-anchored PVS that run
 * Firebird as a service on TCP 3050. The agent runs on the same Praxis
 * server (or one with LAN access) and connects with a read-only account
 * the IT contact provisions per the AVV.
 *
 * Wire library: `node-firebird` (pure-JS, no native build, works on
 * Windows and macOS agents). Bind syntax: Firebird uses positional `?`
 * placeholders; we translate `:name` → `?` and pass values as an ordered
 * array, the same approach as the Postgres driver. Column-name casing:
 * Firebird returns column names UPPER-CASE by default unless quoted.
 * We normalise to lower-case here so the YAML map: blocks can use the
 * same lower-case keys as Postgres configs. (Vendor configs may still
 * SELECT with quoted lower-case aliases to keep the wire data
 * consistent.)
 */

// node-firebird passes result-set metadata as the callback's 3rd argument, but
// as a flat ARRAY of field descriptors, NOT a `{ fields: [...] }` object, and
// each descriptor names the column in `field` / `alias` (not `name`). The array
// is present for empty AND non-empty result sets, so reading it is what lets a
// zero-row poll still report its real columns. The previous `meta.fields` /
// `f.name` access never matched this shape, so the driver always fell back to
// inferring columns from row[0] and reported [] for an empty poll, which the
// framework then misread as "every column vanished" -> false schema drift on
// the (very common) no-new-rows poll. Surfaced by Phase 6's firebird.it harness.
type FbField = { alias?: string; field?: string };

type FbConnection = {
  query(
    sql: string,
    params: unknown[],
    cb: (err: Error | null, rows: Array<Record<string, unknown>>, meta?: FbField[]) => void
  ): void;
  detach(cb?: (err: Error | null) => void): void;
  on(event: "error" | "end", listener: (...args: unknown[]) => void): void;
};

type FbAttach = (
  options: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    role?: string;
    pageSize?: number;
    lowercase_keys?: boolean;
    wireEncryption?: boolean;
  },
  cb: (err: Error | null, db: FbConnection) => void
) => void;

type FbModule = {
  attach: FbAttach;
};

let cachedModule: FbModule | null = null;

async function getModule(): Promise<FbModule> {
  if (cachedModule) return cachedModule;
  const mod = (await import("node-firebird")) as unknown as FbModule & {
    default?: FbModule;
  };
  const resolved = mod.default ?? mod;
  if (!resolved || typeof resolved.attach !== "function") {
    throw new Error(
      "node-firebird module not available. Install dependency 'node-firebird' to use the firebird driver."
    );
  }
  cachedModule = resolved;
  return resolved;
}

export class FirebirdDriver implements DbDriver {
  readonly engine = "firebird" as const;

  private conn: FbConnection | null = null;
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
    if (!params) throw new Error("firebird: connect called without params");
    const mod = await getModule();
    const role = typeof params.options?.role === "string" ? (params.options.role as string) : undefined;
    const pageSize =
      typeof params.options?.pageSize === "number" ? (params.options.pageSize as number) : undefined;
    const wireEncryption =
      params.options?.wireEncryption === false ? false : true;

    const conn: FbConnection = await new Promise((resolve, reject) => {
      mod.attach(
        {
          host: params.host,
          port: params.port || 3050,
          database: params.database,
          user: params.username,
          password: params.password,
          role,
          pageSize,
          lowercase_keys: true,
          wireEncryption,
        },
        (err, db) => {
          if (err) reject(err);
          else resolve(db);
        }
      );
    });

    conn.on("error", (err) => {
      console.error("[firebird] connection error:", err);
      this.healthy = false;
    });
    conn.on("end", () => {
      this.healthy = false;
    });

    // Read-only safety (pentest M10): in Firebird read-only is a property of
    // the TRANSACTION (TPB isc_tpb_read), not the attachment, so there is no
    // connect-time session directive. The `conn.query(...)` path below runs in
    // node-firebird's implicit read-write transaction; pinning it read-only
    // would mean routing every query through an explicit
    // `conn.transaction(ISOLATION_READ_COMMITTED_READ_ONLY, ...)` — a hot-path
    // refactor deferred on this long-tail, undeployed engine. Today the
    // read-only guarantee rests on the SELECT-only Firebird user provisioned
    // per the AVV plus the author-controlled YAML SQL (never user input).
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
    // node-firebird binds a JS Date to a TIMESTAMP parameter natively, so a
    // timestamp cursor (framework Phase 3) flows through as a Date; strings
    // and numbers pass through unchanged.
    const { translated, values } = translateNamedToPositional(sql, params);
    return new Promise<QueryResult>((resolve, reject) => {
      this.conn!.query(translated, values, (err, rows, meta) => {
        if (err) return reject(err);
        // Prefer the statement metadata (stable across empty/non-empty results);
        // lower-case to match the lowercase_keys row shape and the YAML map keys.
        // Fall back to row[0] keys only when no metadata came back at all.
        const columns =
          Array.isArray(meta) && meta.length > 0
            ? meta.map((f) => (f.alias ?? f.field ?? "").toLowerCase())
            : inferColumnsFromRow(rows);
        resolve({ columns, rows: rows ?? [] });
      });
    });
  }

  async close(): Promise<void> {
    if (this.conn) {
      const c = this.conn;
      await new Promise<void>((resolve) => {
        try {
          c.detach(() => resolve());
        } catch {
          resolve();
        }
      });
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
      await new Promise<void>((resolve, reject) => {
        this.conn!.query(
          "SELECT 1 AS heartbeat FROM RDB$DATABASE",
          [],
          (err) => (err ? reject(err) : resolve())
        );
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

/**
 * Translate `:name` placeholders to Firebird's positional `?`. Each
 * occurrence consumes one slot in the values array (Firebird does not
 * deduplicate references to the same bound name), so repeated `:cursor`
 * yields multiple `?` with the same value.
 *
 * SQL is author-controlled (vendor YAML in our own repo), so we don't
 * defend against `:name`-like substrings inside string literals; if that
 * ever changes, swap to a tokenising parser.
 */
export function translateNamedToPositional(
  sql: string,
  params: Record<string, string | number | Date>
): { translated: string; values: unknown[] } {
  const values: unknown[] = [];
  const translated = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
    if (!(name in params)) {
      throw new Error(`firebird: SQL placeholder :${name} has no bound value`);
    }
    values.push(params[name]);
    return "?";
  });
  return { translated, values };
}

function inferColumnsFromRow(rows: Array<Record<string, unknown>> | undefined): string[] {
  if (!rows || rows.length === 0) return [];
  return Object.keys(rows[0]);
}
