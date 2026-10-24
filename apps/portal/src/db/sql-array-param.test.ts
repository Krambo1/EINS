import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// drizzle-orm 0.36 expands a bare JS array inside a sql`` template into a
// row tuple "($1, $2, ...)". So `= ANY(${ids}::text[])` fails on a live
// Postgres ("malformed array literal" with one id, "cannot cast type record
// to text[]" with two or more). Unit tests that mock the db never see this,
// so the processors looked fine until they ran against real data.
// The working form is `= ANY(${sql.param(ids)}::text[])`, which binds the
// whole array as ONE parameter.

const dialect = new PgDialect();

describe("drizzle array binding", () => {
  it("bare array in sql`` expands into a row tuple (the trap)", () => {
    const ids = ["PVS-1", "PVS-2"];
    const q = dialect.sqlToQuery(sql`x = ANY(${ids}::text[])`);
    expect(q.sql).toBe("x = ANY(($1, $2)::text[])");
    expect(q.params).toEqual(["PVS-1", "PVS-2"]);
  });

  it.each([[["PVS-1"]], [["PVS-1", "PVS-2", "PVS-3"]]])(
    "sql.param binds %j as a single array parameter",
    (ids) => {
      const q = dialect.sqlToQuery(sql`x = ANY(${sql.param(ids)}::text[])`);
      expect(q.sql).toBe("x = ANY($1::text[])");
      expect(q.params).toEqual([ids]);
    }
  );
});

// Source scan: every JS value interpolated into ANY(...)/ALL(...) or cast to
// an array type must go through sql.param. Column references (schema.*) are
// rendered as identifiers, not params, and are allowed.

const PORTAL_ROOT = join(__dirname, "../..");
const SCAN_DIRS = ["src", "scripts"];
const SELF = relative(PORTAL_ROOT, __filename).replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) out.push(full);
  }
  return out;
}

const ARRAY_SITE_PATTERNS = [
  // ANY(${expr}  /  ALL(${expr}
  /\b(?:ANY|ALL)\s*\(\s*\$\{([^}]*)\}/gi,
  // ${expr}::text[]  /  ${expr}::uuid[]  ...
  /\$\{([^}]*)\}\s*::\s*\w+\s*\[\]/g,
];

function isSafe(expr: string): boolean {
  const e = expr.trim();
  return e.startsWith("sql.param(") || e.startsWith("schema.");
}

describe("no bare JS arrays in sql`` array positions", () => {
  it("every ANY()/ALL()/::type[] interpolation uses sql.param or a column", () => {
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const file of walk(join(PORTAL_ROOT, d))) {
        const rel = relative(PORTAL_ROOT, file).replace(/\\/g, "/");
        if (rel === SELF) continue;
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          for (const re of ARRAY_SITE_PATTERNS) {
            for (const m of line.matchAll(re)) {
              if (!isSafe(m[1])) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          }
        });
      }
    }
    expect(offenders, "wrap the array in sql.param(...)").toEqual([]);
  });

  it("the scan catches the broken pattern", () => {
    const bad = "sql`x = ANY(" + "${ids}::text[])`";
    const good = "sql`x = ANY(" + "${sql.param(ids)}::text[])`";
    const hits = (s: string) =>
      ARRAY_SITE_PATTERNS.flatMap((re) => [...s.matchAll(re)]).filter((m) => !isSafe(m[1])).length;
    expect(hits(bad)).toBeGreaterThan(0);
    expect(hits(good)).toBe(0);
  });
});
