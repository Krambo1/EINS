/**
 * Pure SQL-text helpers for the migration runner (src/db/migrate.ts), split
 * out so they are unit-testable without a database.
 */

/** Statements Postgres refuses to run inside a transaction block. */
const NO_TX_PATTERN =
  /\b(create\s+(unique\s+)?index\s+concurrently|drop\s+index\s+concurrently|reindex\s+(\w+\s+)?concurrently)\b/i;

/**
 * Split a SQL script into top-level statements. Understands `--` and
 * `/* *\/` comments, single-quoted strings, double-quoted identifiers and
 * dollar-quoted bodies (`DO $$ ... $$`, `$fn$ ... $fn$`), so semicolons inside
 * those never split. Comments are dropped; empty statements are skipped.
 */
export function splitSqlStatements(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i]!;
    const next = body[i + 1];
    if (c === "-" && next === "-") {
      const end = body.indexOf("\n", i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      cur += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (body[j] === c) {
          if (body[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += body.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(body.slice(i));
      if (m) {
        const tag = m[0];
        const end = body.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += body.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * True when the script contains a statement that cannot run in a transaction.
 * Comments are ignored: a file that only MENTIONS `CONCURRENTLY` in a comment
 * stays transactional (it used to run bare and could be left half-applied).
 */
export function requiresNoTransaction(body: string): boolean {
  return splitSqlStatements(body).some((s) => NO_TX_PATTERN.test(s));
}

/**
 * Pending files that sort BEFORE the newest applied one. They still get
 * applied (parallel workstreams reserve numbers ahead of time), but the
 * runner warns because on a fresh database they would run in a different
 * order than they did here.
 */
export function outOfOrder(pending: string[], applied: Iterable<string>): string[] {
  let newest = "";
  for (const v of applied) if (v > newest) newest = v;
  return pending.filter((v) => v < newest);
}

/** Version prefixes (`0015`) shared by more than one file, beyond `allowed`. */
export function duplicatePrefixes(versions: string[], allowed: ReadonlySet<string>): string[] {
  const seen = new Map<string, number>();
  for (const v of versions) {
    const p = v.split("_")[0]!;
    seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  return [...seen].filter(([p, c]) => c > 1 && !allowed.has(p)).map(([p]) => p);
}
