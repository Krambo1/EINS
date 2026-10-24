import {
  baseTable,
  isSafeIdentifierPath,
  referencedColumns,
  referencedTables,
} from "./sql-analysis.js";
import type {
  CatalogSummary,
  DbConnectionParams,
  DbDriver,
  VendorConfig,
} from "./types.js";

/**
 * Schema discovery.
 *
 * Every bundled vendor YAML is a schema hypothesis. This module reads the
 * ENGINE CATALOG of a real Praxis database (table / column names, types and
 * approximate row counts; never row data) and diffs it against the tables and
 * columns the YAML queries reference, so first contact with a real PVS yields a
 * concrete "table X is called Y here" list instead of a halted stream.
 *
 *   eins-agent --probe-db-adapter <vendor-id>
 *
 * Read-only by construction: only SELECTs against catalog views, plus
 * `SELECT COUNT(*)` on the (few) tables the YAML references for engines whose
 * catalog carries no row estimate (Firebird, SQLite).
 */

export interface ProbeColumn {
  name: string;
  type: string;
}

export interface ProbeTable {
  schema: string | null;
  name: string;
  rowCount: number | null;
  /** true when rowCount is a catalog estimate rather than COUNT(*). */
  rowCountApprox: boolean;
  columns: ProbeColumn[];
}

export interface StreamSchemaDiff {
  stream: string;
  tables: string[];
  missingTables: string[];
  missingColumns: string[];
  /** Unqualified identifiers found in no referenced table (best effort: select
   *  aliases and expressions can produce false positives). */
  unresolvedIdentifiers: string[];
}

export interface SchemaProbeResult {
  engine: string;
  tables: ProbeTable[];
  streams: StreamSchemaDiff[];
  /** Union over all streams. */
  missingTables: string[];
  missingColumns: string[];
  /** Non-fatal problems while reading the catalog (e.g. a count that failed). */
  warnings: string[];
}

export interface ProbeOptions {
  /** Oracle schema owner; defaults to connection.options.owner|schema, then the
   *  session's CURRENT_SCHEMA. */
  owner?: string;
  /** Max tables to COUNT(*) on engines without a catalog estimate. */
  maxExactCounts?: number;
}

type Row = Record<string, unknown>;

function lc(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v;
  return out;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Firebird RDB$FIELDS.RDB$FIELD_TYPE codes.
const FB_TYPES: Record<number, string> = {
  7: "SMALLINT",
  8: "INTEGER",
  10: "FLOAT",
  12: "DATE",
  13: "TIME",
  14: "CHAR",
  16: "BIGINT/NUMERIC",
  23: "BOOLEAN",
  27: "DOUBLE",
  35: "TIMESTAMP",
  37: "VARCHAR",
  261: "BLOB",
};

interface RawColumn {
  schema: string | null;
  table: string;
  column: string;
  type: string;
}

async function readCatalog(
  driver: DbDriver,
  vendor: VendorConfig,
  opts: ProbeOptions
): Promise<{
  columns: RawColumn[];
  counts: Map<string, number>;
  approxCounts: boolean;
}> {
  const counts = new Map<string, number>();
  const key = (schema: string | null, table: string) =>
    `${(schema ?? "").toLowerCase()}.${table.toLowerCase()}`;
  const columns: RawColumn[] = [];

  switch (driver.engine) {
    case "postgres": {
      const cols = await driver.query(
        `SELECT table_schema, table_name, column_name, data_type
           FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog','information_schema')
          ORDER BY table_schema, table_name, ordinal_position`,
        {}
      );
      for (const r of cols.rows.map(lc)) {
        columns.push({ schema: str(r.table_schema), table: str(r.table_name), column: str(r.column_name), type: str(r.data_type) });
      }
      try {
        const c = await driver.query(
          `SELECT n.nspname AS table_schema, c.relname AS table_name, c.reltuples::bigint AS row_count
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')`,
          {}
        );
        for (const r of c.rows.map(lc)) {
          const n = num(r.row_count);
          if (n !== null) counts.set(key(str(r.table_schema), str(r.table_name)), Math.max(0, n));
        }
      } catch {
        /* estimates are optional */
      }
      return { columns, counts, approxCounts: true };
    }
    case "mysql": {
      const cols = await driver.query(
        `SELECT table_name, column_name, data_type
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
          ORDER BY table_name, ordinal_position`,
        {}
      );
      for (const r of cols.rows.map(lc)) {
        columns.push({ schema: null, table: str(r.table_name), column: str(r.column_name), type: str(r.data_type) });
      }
      try {
        const c = await driver.query(
          `SELECT table_name, table_rows AS row_count FROM information_schema.tables WHERE table_schema = DATABASE()`,
          {}
        );
        for (const r of c.rows.map(lc)) {
          const n = num(r.row_count);
          if (n !== null) counts.set(key(null, str(r.table_name)), n);
        }
      } catch {
        /* optional */
      }
      return { columns, counts, approxCounts: true };
    }
    case "mssql": {
      const cols = await driver.query(
        `SELECT s.name AS table_schema, t.name AS table_name, c.name AS column_name, ty.name AS data_type
           FROM sys.tables t
           JOIN sys.schemas s ON s.schema_id = t.schema_id
           JOIN sys.columns c ON c.object_id = t.object_id
           JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          ORDER BY s.name, t.name, c.column_id`,
        {}
      );
      for (const r of cols.rows.map(lc)) {
        columns.push({ schema: str(r.table_schema), table: str(r.table_name), column: str(r.column_name), type: str(r.data_type) });
      }
      try {
        const c = await driver.query(
          `SELECT s.name AS table_schema, t.name AS table_name, SUM(p.rows) AS row_count
             FROM sys.tables t
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
            GROUP BY s.name, t.name`,
          {}
        );
        for (const r of c.rows.map(lc)) {
          const n = num(r.row_count);
          if (n !== null) counts.set(key(str(r.table_schema), str(r.table_name)), n);
        }
      } catch {
        /* optional */
      }
      return { columns, counts, approxCounts: true };
    }
    case "oracle": {
      const ownerOpt =
        opts.owner ??
        (typeof vendor.connection.options?.owner === "string"
          ? (vendor.connection.options.owner as string)
          : typeof vendor.connection.options?.schema === "string"
            ? (vendor.connection.options.schema as string)
            : undefined);
      const ownerSql =
        ownerOpt && /^[A-Za-z][A-Za-z0-9_$#]*$/.test(ownerOpt)
          ? `'${ownerOpt.toUpperCase()}'`
          : `SYS_CONTEXT('USERENV','CURRENT_SCHEMA')`;
      const cols = await driver.query(
        `SELECT owner AS table_schema, table_name, column_name, data_type
           FROM all_tab_columns
          WHERE owner = ${ownerSql}
          ORDER BY table_name, column_id`,
        {}
      );
      for (const r of cols.rows.map(lc)) {
        columns.push({ schema: str(r.table_schema), table: str(r.table_name), column: str(r.column_name), type: str(r.data_type) });
      }
      try {
        const c = await driver.query(
          `SELECT owner AS table_schema, table_name, num_rows AS row_count FROM all_tables WHERE owner = ${ownerSql}`,
          {}
        );
        for (const r of c.rows.map(lc)) {
          const n = num(r.row_count);
          if (n !== null) counts.set(key(str(r.table_schema), str(r.table_name)), n);
        }
      } catch {
        /* optional */
      }
      return { columns, counts, approxCounts: true };
    }
    case "firebird": {
      const cols = await driver.query(
        `SELECT TRIM(rf.RDB$RELATION_NAME) AS table_name,
                TRIM(rf.RDB$FIELD_NAME) AS column_name,
                f.RDB$FIELD_TYPE AS field_type
           FROM RDB$RELATION_FIELDS rf
           JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
           JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
          WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
          ORDER BY rf.RDB$RELATION_NAME, rf.RDB$FIELD_POSITION`,
        {}
      );
      for (const r of cols.rows.map(lc)) {
        const code = num(r.field_type);
        columns.push({
          schema: null,
          table: str(r.table_name),
          column: str(r.column_name),
          type: code !== null ? (FB_TYPES[code] ?? `type${code}`) : "",
        });
      }
      return { columns, counts, approxCounts: false };
    }
    case "sqlite": {
      const cols = await driver.query(
        `SELECT m.name AS table_name, p.name AS column_name, p.type AS data_type
           FROM sqlite_master m, pragma_table_info(m.name) p
          WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'
          ORDER BY m.name, p.cid`,
        {}
      );
      for (const r of cols.rows.map(lc)) {
        columns.push({ schema: null, table: str(r.table_name), column: str(r.column_name), type: str(r.data_type) });
      }
      return { columns, counts, approxCounts: false };
    }
  }
}

function unquote(s: string): string {
  return s.replace(/^["`\[]|["`\]]$/g, "");
}

/** Split `schema.table` as written in a query (quotes already stripped). */
function splitName(name: string): { schema: string | null; table: string } {
  const parts = name.split(".").map(unquote);
  if (parts.length === 1) return { schema: null, table: parts[0] };
  return { schema: parts[parts.length - 2], table: parts[parts.length - 1] };
}

function findTable(
  tables: ProbeTable[],
  ref: { schema: string | null; table: string }
): ProbeTable | undefined {
  const t = ref.table.toLowerCase();
  const s = ref.schema?.toLowerCase();
  const candidates = tables.filter((x) => x.name.toLowerCase() === t);
  if (s) return candidates.find((x) => (x.schema ?? "").toLowerCase() === s);
  return candidates[0];
}

/** Read the catalog and diff it against what the YAML references. */
export async function probeSchema(
  driver: DbDriver,
  vendor: VendorConfig,
  opts: ProbeOptions = {}
): Promise<SchemaProbeResult> {
  const warnings: string[] = [];
  const { columns, counts, approxCounts } = await readCatalog(driver, vendor, opts);

  const byKey = new Map<string, ProbeTable>();
  for (const c of columns) {
    const k = `${(c.schema ?? "").toLowerCase()}.${c.table.toLowerCase()}`;
    let t = byKey.get(k);
    if (!t) {
      t = {
        schema: c.schema,
        name: c.table,
        rowCount: counts.get(k) ?? null,
        rowCountApprox: counts.has(k) ? approxCounts : false,
        columns: [],
      };
      byKey.set(k, t);
    }
    t.columns.push({ name: c.column, type: c.type });
  }
  const tables = [...byKey.values()];

  // Per-stream diff.
  const streams: StreamSchemaDiff[] = [];
  const referenced: ProbeTable[] = [];
  for (const stream of vendor.streams) {
    const refs = referencedTables(stream.query);
    const diag = stream.diagnosticTable ? [{ name: stream.diagnosticTable, alias: null }] : [];
    const missingTables: string[] = [];
    const missingColumns: string[] = [];
    const resolved: Array<{ ref: (typeof refs)[number]; table: ProbeTable }> = [];
    for (const ref of [...refs, ...diag]) {
      const found = findTable(tables, splitName(ref.name));
      if (!found) {
        if (!missingTables.includes(ref.name)) missingTables.push(ref.name);
      } else {
        resolved.push({ ref, table: found });
        if (!referenced.includes(found)) referenced.push(found);
      }
    }
    const colRefs = referencedColumns(stream.query);
    const unresolved: string[] = [];
    for (const cr of colRefs) {
      if (cr.qualifier) {
        const q = unquote(cr.qualifier).toLowerCase();
        const target = resolved.find(
          (r) =>
            (r.ref.alias ?? "").toLowerCase() === q ||
            splitName(r.ref.name).table.toLowerCase() === q
        );
        if (!target) continue; // qualifier of a missing table / subselect alias
        if (!target.table.columns.some((c) => c.name.toLowerCase() === cr.column.toLowerCase())) {
          const label = `${target.table.name}.${cr.column}`;
          if (!missingColumns.includes(label)) missingColumns.push(label);
        }
      } else if (missingTables.length === 0 && resolved.length > 0) {
        const lower = cr.column.toLowerCase();
        if (!resolved.some((r) => r.table.columns.some((c) => c.name.toLowerCase() === lower))) {
          unresolved.push(cr.column);
        }
      }
    }
    streams.push({
      stream: stream.kind,
      tables: refs.map((r) => r.name),
      missingTables,
      missingColumns,
      unresolvedIdentifiers: unresolved,
    });
  }

  // Exact counts for referenced tables on engines without a catalog estimate.
  if (!approxCounts) {
    const max = opts.maxExactCounts ?? 12;
    for (const t of referenced.slice(0, max)) {
      if (t.rowCount !== null) continue;
      const qualified = t.schema ? `${t.schema}.${t.name}` : t.name;
      if (!isSafeIdentifierPath(qualified)) continue;
      try {
        const r = await driver.query(`SELECT COUNT(*) AS n FROM ${qualified}`, {});
        const first = r.rows[0] ? Object.values(r.rows[0])[0] : null;
        t.rowCount = num(first);
        t.rowCountApprox = false;
      } catch (err) {
        warnings.push(`row count of ${qualified} failed: ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }

  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    engine: driver.engine,
    tables,
    streams,
    missingTables: uniq(streams.flatMap((s) => s.missingTables)),
    missingColumns: uniq(streams.flatMap((s) => s.missingColumns)),
    warnings,
  };
}

/**
 * Compact form for a drift report: every referenced table with its columns,
 * plus the names of up to `maxOtherTables` further tables so an operator can
 * spot the renamed one. Names, types and counts only.
 */
export function summarizeForReport(
  result: SchemaProbeResult,
  vendor: VendorConfig,
  limits: { maxColumns?: number; maxOtherTables?: number } = {}
): CatalogSummary {
  const maxColumns = limits.maxColumns ?? 400;
  const maxOther = limits.maxOtherTables ?? 80;
  const refNames = new Set<string>();
  for (const s of vendor.streams) {
    for (const r of referencedTables(s.query)) refNames.add(splitName(r.name).table.toLowerCase());
    if (s.diagnosticTable) refNames.add(splitName(s.diagnosticTable).table.toLowerCase());
    const b = baseTable(s.query);
    if (b) refNames.add(splitName(b).table.toLowerCase());
  }
  let budget = maxColumns;
  const tables: CatalogSummary["tables"] = [];
  const others: string[] = [];
  for (const t of result.tables) {
    if (refNames.has(t.name.toLowerCase()) && budget > 0) {
      const cols = t.columns.slice(0, budget);
      budget -= cols.length;
      tables.push({ name: t.schema ? `${t.schema}.${t.name}` : t.name, rowCount: t.rowCount, columns: cols });
    } else {
      others.push(t.name);
    }
  }
  return {
    engine: result.engine,
    missingTables: result.missingTables,
    missingColumns: result.missingColumns,
    tables,
    otherTables: others.slice(0, maxOther),
  };
}

// ---------- CLI -----------------------------------------------------------

export interface ProbeCliOptions {
  vendorId: string;
  /** Connection override as stored in the agent config (cfg.dbAdapters entry). */
  connection: { host: string; port?: number; database?: string; username: string };
  configsDir?: string;
  /** Raw remote YAMLs to overlay (defaults to the local remote-config store). */
  remoteConfigs?: ReadonlyMap<string, string>;
  credentialLoader?: (credentialId: string) => Promise<string | null>;
  driverFactory?: (vendor: VendorConfig) => DbDriver;
  /** Output sink; defaults to console.log. */
  print?: (line: string) => void;
  /** Emit the raw SchemaProbeResult as JSON instead of the text report. */
  json?: boolean;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function closest(name: string, pool: string[]): string[] {
  const n = name.toLowerCase();
  return pool
    .map((p) => ({ p, d: levenshtein(n, p.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(3, Math.floor(n.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.p);
}

/**
 * `eins-agent --probe-db-adapter <vendor-id>`: connect with the stored
 * credential, read the catalog and print the diff. Exit code 0 = every table
 * and column the YAML references exists, 1 = differences, 2 = could not run.
 */
export async function runSchemaProbeCli(opts: ProbeCliOptions): Promise<number> {
  const print = opts.print ?? ((l: string) => console.log(l));
  // Dynamic imports keep this module free of a static cycle with the runner
  // (runner -> framework -> schema-probe).
  const runner = await import("./runner.js");
  const secure = await import("../secure-store.js");
  const configsDir = opts.configsDir ?? runner.defaultConfigsDir();
  const remote =
    opts.remoteConfigs ?? (await runner.loadStoredRemoteConfigs([opts.vendorId]));
  const { loadEffectiveVendorConfigs } = await import("./vendor-config.js");
  const all = await loadEffectiveVendorConfigs(configsDir, remote);
  const vendor = all.get(opts.vendorId);
  if (!vendor) {
    print(`unknown vendor '${opts.vendorId}'. Known: ${[...all.keys()].join(", ")}`);
    return 2;
  }
  const password = await (opts.credentialLoader ?? secure.loadDbCredential)(
    vendor.connection.credentialId
  );
  if (!password) {
    print(
      `no credential stored for '${vendor.connection.credentialId}'. Run: eins-agent --rotate-db-credential ${vendor.connection.credentialId}`
    );
    return 2;
  }
  const driver = (opts.driverFactory ?? runner.defaultDriverFactory)(vendor);
  const params: DbConnectionParams = {
    host: opts.connection.host,
    port:
      opts.connection.port ??
      vendor.connection.port ??
      runner.defaultPortForEngine(vendor.driver),
    database: opts.connection.database ?? vendor.connection.database ?? "",
    username: opts.connection.username,
    password,
    options: vendor.connection.options,
  };
  try {
    await driver.connect(params);
    const result = await probeSchema(driver, vendor);
    if (opts.json) {
      print(JSON.stringify(result, null, 2));
    } else {
      print(`vendor ${vendor.vendor} (${result.engine}): ${result.tables.length} tables in the catalog`);
      const names = result.tables.map((t) => t.name);
      for (const s of result.streams) {
        print(`\n[${s.stream}] tables: ${s.tables.join(", ") || "(none found)"}`);
        for (const t of s.missingTables) {
          const hint = closest(splitName(t).table, names);
          print(`  MISSING TABLE ${t}${hint.length ? `   similar: ${hint.join(", ")}` : ""}`);
        }
        for (const c of s.missingColumns) {
          const [tbl, col] = c.split(".");
          const table = result.tables.find((x) => x.name === tbl);
          const hint = table ? closest(col, table.columns.map((x) => x.name)) : [];
          print(`  MISSING COLUMN ${c}${hint.length ? `   similar: ${hint.join(", ")}` : ""}`);
        }
        if (s.unresolvedIdentifiers.length > 0) {
          print(`  unresolved identifiers (best effort): ${s.unresolvedIdentifiers.join(", ")}`);
        }
      }
      print("\nreferenced tables:");
      const refNames = new Set(
        result.streams.flatMap((s) => s.tables.map((t) => splitName(t).table.toLowerCase()))
      );
      for (const t of result.tables.filter((x) => refNames.has(x.name.toLowerCase()))) {
        const rc =
          t.rowCount === null ? "?" : `${t.rowCountApprox ? "~" : ""}${t.rowCount}`;
        print(`  ${t.name} (${rc} rows): ${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}`);
      }
      print(
        `\nall tables: ${names.slice(0, 300).join(", ")}${names.length > 300 ? ` ... (+${names.length - 300})` : ""}`
      );
      for (const w of result.warnings) print(`warning: ${w}`);
    }
    return result.missingTables.length === 0 && result.missingColumns.length === 0 ? 0 : 1;
  } catch (err) {
    print(`probe failed: ${(err as Error).message}`);
    return 2;
  } finally {
    await driver.close().catch(() => void 0);
  }
}
