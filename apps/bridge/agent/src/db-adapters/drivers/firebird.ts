import iconv from "iconv-lite";
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
 *
 * READ SAFETY. Every read runs in an explicit READ ONLY, READ COMMITTED +
 * REC_VERSION, NO WAIT transaction (isc_tpb_read | read_committed | rec_version
 * | nowait). node-firebird's default `conn.query()` would use an implicit
 * read-write, WAIT-forever transaction: a reader would then block on a PVS
 * writer's uncommitted row (or hold an old snapshot open and pin garbage
 * collection on the server). With rec_version the reader sees the last committed
 * version and never waits; read-only makes a write impossible.
 *
 * TRANSPORT. node-firebird 1.1.10 implements NO wire encryption (verified in
 * lib/wire/connection.js: there is no isc_dpb wire_crypt / WireCrypt handling).
 * An earlier `wireEncryption: true` option was therefore a silent no-op that
 * claimed protection it did not give. Traffic is UNENCRYPTED on the LAN: run
 * the agent on the Firebird server (host localhost) or on a trusted wired LAN.
 *
 * AUTH. node-firebird speaks Srp (SHA-1) and Legacy_Auth. Firebird 4+ ships with
 * AuthServer = Srp256 only; the handshake then fails with an authentication
 * error even for a correct password. The runner classifies that as auth_failed
 * and reports the actionable hint (error-classes.FIREBIRD_AUTH_HINT).
 *
 * CHARSET. The driver decodes every text column as UTF-8, whatever the
 * connection charset. A WIN1252 database read over the default UTF8 connection
 * is transliterated by the server and arrives intact. Columns of charset NONE
 * arrive as raw bytes that are not valid UTF-8; for those CAST the column to
 * `CHARACTER SET OCTETS` in the query (node-firebird then returns a Buffer) and
 * set `charset`/`decodeAs` so the bytes are decoded with iconv-lite. A text
 * value that still contains U+FFFD (undecodable bytes) is nulled, counted and
 * logged so one umlaut row can neither wedge the stream nor emit garbage.
 */

// node-firebird passes result-set metadata as the callback's 3rd argument, but
// as a flat ARRAY of field descriptors, NOT a `{ fields: [...] }` object, and
// each descriptor names the column in `field` / `alias` (not `name`). The array
// is present for empty AND non-empty result sets, so reading it is what lets a
// zero-row poll still report its real columns.
type FbField = { alias?: string; field?: string };

type FbTransaction = {
  query(
    sql: string,
    params: unknown[],
    cb: (err: Error | null, rows: Array<Record<string, unknown>>, meta?: FbField[]) => void
  ): void;
  commit(cb: (err?: Error | null) => void): void;
  rollback(cb: (err?: Error | null) => void): void;
};

type FbConnection = {
  query(
    sql: string,
    params: unknown[],
    cb: (err: Error | null, rows: Array<Record<string, unknown>>, meta?: FbField[]) => void
  ): void;
  transaction(
    options: {
      isolation: number[];
      readOnly: boolean;
      wait: boolean;
      autoUndo?: boolean;
    },
    cb: (err: Error | null, tx: FbTransaction) => void
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
    /** Return BLOB SUB_TYPE TEXT columns as strings. Without it node-firebird
     *  hands back a lazy reader FUNCTION per cell (String()-ified into JS source
     *  text downstream). */
    blobAsText?: boolean;
    /** Connection charset (Firebird lc_ctype). node-firebird maps this to
     *  isc_dpb_lc_ctype and defaults to 'UTF8' when omitted (M-D3). */
    encoding?: string;
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

/** TPB isolation for the read transaction: isc_tpb_read_committed (15) +
 *  isc_tpb_rec_version (17). Mirrors node-firebird's ISOLATION_READ_UNCOMMITTED
 *  constant, which is the same two bytes; spelled out here because that name is
 *  misleading. */
const READ_COMMITTED_REC_VERSION = [15, 17];

/** A single read may take this long before the connection is discarded. The
 *  framework has its own 150 s backstop; this one also drops the connection so
 *  the next stream cannot reuse a wedged socket. */
const QUERY_TIMEOUT_MS = 120_000;
/** Do not wait on a detach of a wedged socket for longer than this. */
const DETACH_TIMEOUT_MS = 5_000;

export class FirebirdDriver implements DbDriver {
  readonly engine = "firebird" as const;

  private conn: FbConnection | null = null;
  private params: DbConnectionParams | null = null;
  private connecting: Promise<void> | null = null;
  private healthy = false;
  /** Count of text values nulled because they contained undecodable bytes. */
  undecodableValues = 0;
  private lastUndecodableLogAt = 0;

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
    // M-D5: release the previous connection before reconnecting. A flapping LAN
    // drives repeated doConnect() calls (the 'error'/'end' handlers flip
    // `healthy` false while `conn` is still set); without detaching the old
    // handle each rebuild leaks a dead Firebird attachment that accumulates on
    // the Praxis server over days. Best-effort and fire-and-forget so a hung
    // detach on a half-dead socket cannot stall the reconnect.
    if (this.conn) {
      const stale = this.conn;
      this.conn = null;
      this.healthy = false;
      try {
        stale.detach(() => void 0);
      } catch {
        // ignore: the old attachment may already be gone
      }
    }
    const mod = await getModule();
    const role = typeof params.options?.role === "string" ? (params.options.role as string) : undefined;
    const pageSize =
      typeof params.options?.pageSize === "number" ? (params.options.pageSize as number) : undefined;
    if (params.options?.wireEncryption === true) {
      console.warn(
        "[firebird] connection.options.wireEncryption is ignored: node-firebird cannot encrypt the wire. Run the agent on the Firebird server (host localhost) or on a trusted LAN."
      );
    }
    // M-D3: optional connection charset for legacy WIN1252 / NONE databases
    // whose umlauts otherwise garble. Undefined leaves node-firebird on its
    // 'UTF8' default, so existing configs are unchanged.
    const encoding = resolveFirebirdEncoding(params.options);

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
          blobAsText: true,
          encoding,
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

    this.conn = conn;
    this.healthy = true;
  }

  /** Drop the connection synchronously (never await a detach on a wedged
   *  socket) so the next query reconnects instead of reusing it. */
  private discardConnection(): void {
    const c = this.conn;
    this.conn = null;
    this.healthy = false;
    if (!c) return;
    try {
      c.detach(() => void 0);
    } catch {
      // best-effort
    }
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
    const conn = this.conn!;
    const decodeAs = resolveFirebirdDecodeCharset(this.params?.options);
    return new Promise<QueryResult>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => {
          this.discardConnection();
          reject(new Error(`firebird: query exceeded ${QUERY_TIMEOUT_MS}ms; connection discarded`));
        });
      }, QUERY_TIMEOUT_MS);

      conn.transaction(
        {
          isolation: READ_COMMITTED_REC_VERSION,
          readOnly: true,
          // NO WAIT: never queue behind a lock held by the PVS.
          wait: false,
        },
        (txErr, tx) => {
          if (txErr) {
            return finish(() => {
              this.healthy = false;
              reject(txErr);
            });
          }
          tx.query(translated, values, (err, rows, meta) => {
            const end = (cb: () => void): void => {
              // Release the transaction either way; a failing commit of a
              // read-only transaction is not worth failing the poll over.
              try {
                (err ? tx.rollback.bind(tx) : tx.commit.bind(tx))(() => cb());
              } catch {
                cb();
              }
            };
            if (err) {
              return end(() => finish(() => reject(err)));
            }
            end(() =>
              finish(() => {
                // Prefer the statement metadata (stable across empty/non-empty
                // results); lower-case to match the lowercase_keys row shape and
                // the YAML map keys. Fall back to row[0] keys only when no
                // metadata came back at all.
                const columns =
                  Array.isArray(meta) && meta.length > 0
                    ? meta.map((f) => (f.alias ?? f.field ?? "").toLowerCase())
                    : inferColumnsFromRow(rows);
                const decoded = this.decodeRows(rows ?? [], decodeAs);
                resolve({ columns, rows: decoded });
              })
            );
          });
        }
      );
    });
  }

  /** Decode Buffer columns with iconv-lite and null (count, log) any text value
   *  that still carries undecodable bytes. */
  private decodeRows(
    rows: Array<Record<string, unknown>>,
    decodeAs: string
  ): Array<Record<string, unknown>> {
    let bad = 0;
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        const v = row[key];
        if (Buffer.isBuffer(v)) {
          const text = iconv.decode(v, decodeAs);
          if (text.includes("�")) {
            row[key] = null;
            bad++;
          } else {
            row[key] = text;
          }
        } else if (typeof v === "string" && v.includes("�")) {
          row[key] = null;
          bad++;
        }
      }
    }
    if (bad > 0) {
      this.undecodableValues += bad;
      const now = Date.now();
      if (now - this.lastUndecodableLogAt > 60_000) {
        this.lastUndecodableLogAt = now;
        console.warn(
          `[firebird] ${bad} text value(s) in this result held undecodable bytes and were set to NULL (total ${this.undecodableValues}). For charset NONE columns CAST them to CHARACTER SET OCTETS in the query and set connection.options.charset / decodeAs.`
        );
      }
    }
    return rows;
  }

  async close(): Promise<void> {
    const c = this.conn;
    // Reset synchronously: if detach never calls back (wedged socket) the next
    // query must still reconnect instead of reusing this connection.
    this.conn = null;
    this.healthy = false;
    if (!c) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DETACH_TIMEOUT_MS);
      try {
        c.detach(() => {
          clearTimeout(timer);
          resolve();
        });
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      if (!this.conn || !this.healthy) {
        if (!this.params) return { ok: false, reason: "not configured" };
        await this.connect(this.params);
      }
      await this.query("SELECT 1 AS heartbeat FROM RDB$DATABASE", {});
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

/**
 * Resolve the optional connection charset (M-D3) from the vendor connection
 * `options` bag. Accepts either `charset` or `encoding` (both plumbed through
 * the vendor YAML `connection.options`); `charset` wins when both are present.
 * Returns undefined when neither is a non-empty string, which leaves
 * node-firebird on its 'UTF8' default so current behaviour is preserved.
 *
 * Legacy medatixx / Turbomed / Quincy installs whose database was created with
 * WIN1252 or NONE can set `charset: "WIN1252"` (or "NONE") so umlauts read back
 * intact instead of garbling or raising a transliteration error that would burn
 * the stream's failure budget as a generic error.
 */
export function resolveFirebirdEncoding(
  options: Record<string, unknown> | undefined
): string | undefined {
  const raw = options?.charset ?? options?.encoding;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return undefined;
}

const FB_CHARSET_TO_ICONV: Record<string, string> = {
  UTF8: "utf8",
  UNICODE_FSS: "utf8",
  WIN1250: "win1250",
  WIN1251: "win1251",
  WIN1252: "win1252",
  WIN1253: "win1253",
  WIN1254: "win1254",
  ISO8859_1: "latin1",
  ISO8859_2: "iso-8859-2",
  ISO8859_15: "iso-8859-15",
  DOS850: "cp850",
  DOS437: "cp437",
  // NONE carries no charset information; German PVS data is Windows-1252.
  NONE: "win1252",
  OCTETS: "win1252",
};

/**
 * The iconv-lite charset used to decode Buffer columns (text cast to OCTETS):
 * `decodeAs` if set, else derived from the connection charset, else win1252
 * (German PVS data is Windows-1252, not UTF-8). Unknown names fall back to
 * win1252.
 */
export function resolveFirebirdDecodeCharset(
  options: Record<string, unknown> | undefined
): string {
  const explicit = options?.decodeAs;
  const raw =
    typeof explicit === "string" && explicit.trim() !== ""
      ? explicit.trim()
      : resolveFirebirdEncoding(options);
  if (!raw) return "win1252";
  const mapped = FB_CHARSET_TO_ICONV[raw.toUpperCase()] ?? raw.toLowerCase();
  return iconv.encodingExists(mapped) ? mapped : "win1252";
}
