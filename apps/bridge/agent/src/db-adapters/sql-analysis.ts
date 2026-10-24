/**
 * Small lexical SQL analysis for vendor-YAML queries.
 *
 * The queries are author-controlled (signed remote configs or the bundled
 * YAMLs), so this is NOT a security parser. It exists so a typo that would
 * otherwise show up as a 1 s hot loop at 2 am on a Praxis server (cursor column
 * not in the SELECT list, a stray `;`, a DML statement) fails at config load
 * instead, and so the schema probe / empty-stream diagnostic can name the
 * tables a query reads.
 *
 * Deliberately lexical: it understands comments, string literals, quoted
 * identifiers, bind parameters and parenthesis depth, and nothing else. Anything
 * it cannot judge returns null/undefined and the caller must treat that as
 * "no opinion", never as a failure.
 */

export type TokenType = "word" | "quoted" | "string" | "param" | "number" | "punct";

export interface Token {
  type: TokenType;
  /** Raw text; for `quoted` the identifier WITHOUT its quotes. */
  text: string;
  /** Parenthesis depth at this token (the token itself excluded for `(`). */
  depth: number;
}

export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  const push = (type: TokenType, text: string) => out.push({ type, text, depth });
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      push("string", sql.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const end = sql.indexOf(close, i + 1);
      if (end !== -1 && (c !== "[" || /^[^\]\n]+$/.test(sql.slice(i + 1, end)))) {
        push("quoted", sql.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (c === ":" && sql[i + 1] === ":") {
      push("punct", "::");
      i += 2;
      continue;
    }
    if (c === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      push("param", sql.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$#]/.test(sql[j])) j++;
      push("word", sql.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(sql[j])) j++;
      push("number", sql.slice(i, j));
      i = j;
      continue;
    }
    if (c === "(") {
      push("punct", "(");
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      push("punct", ")");
      i++;
      continue;
    }
    push("punct", c);
    i++;
  }
  return out;
}

const up = (t: Token | undefined): string =>
  t && t.type === "word" ? t.text.toUpperCase() : "";

const FORBIDDEN_WORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "MERGE",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "REVOKE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
]);

/**
 * Null when the query is one plain SELECT (optionally WITH ... SELECT), else a
 * human-readable reason. A single trailing `;` is tolerated.
 */
export function validateSingleSelect(sql: string): string | null {
  const tokens = tokenize(sql);
  while (tokens.length > 0 && tokens[tokens.length - 1].text === ";") tokens.pop();
  if (tokens.length === 0) return "query is empty";
  if (tokens.some((t) => t.type === "punct" && t.text === ";")) {
    return "query contains more than one statement (';' separated); only a single SELECT is allowed";
  }
  const first = up(tokens[0]);
  if (first !== "SELECT" && first !== "WITH") {
    return `query must start with SELECT (or WITH ... SELECT), found '${tokens[0].text}'`;
  }
  for (const t of tokens) {
    const w = up(t);
    if (w && FORBIDDEN_WORDS.has(w)) {
      return `query contains the data-changing/DDL keyword '${w}'; only read-only SELECT queries are allowed`;
    }
  }
  return null;
}

/** Index of the main SELECT keyword (depth 0), or -1. */
function mainSelectIndex(tokens: Token[]): number {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].depth === 0 && up(tokens[i]) === "SELECT") return i;
  }
  return -1;
}

/**
 * Output column names of the main SELECT list, lower-cased, or null when the
 * list cannot be named (SELECT *, unparsable). Entries that have no determinable
 * name (an unaliased expression) are skipped.
 */
export function selectOutputColumns(sql: string): string[] | null {
  const tokens = tokenize(sql);
  const s = mainSelectIndex(tokens);
  if (s === -1) return null;
  let i = s + 1;
  // Skip modifiers: DISTINCT/ALL, TOP n | TOP (expr), FIRST/SKIP n|(expr)|:p.
  for (;;) {
    const w = up(tokens[i]);
    if (w === "DISTINCT" || w === "ALL") {
      i++;
    } else if (w === "TOP" || w === "FIRST" || w === "SKIP") {
      i++;
      if (tokens[i]?.text === "(") {
        const d = tokens[i].depth;
        i++;
        while (i < tokens.length && !(tokens[i].text === ")" && tokens[i].depth === d)) i++;
        i++;
      } else {
        i++;
      }
      if (up(tokens[i]) === "PERCENT") i++;
    } else {
      break;
    }
  }
  const items: Token[][] = [[]];
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.depth === 0 && up(t) === "FROM") break;
    if (t.depth === 0 && t.text === ",") {
      items.push([]);
      continue;
    }
    items[items.length - 1].push(t);
  }
  const names: string[] = [];
  for (const item of items) {
    if (item.length === 0) return null;
    const last = item[item.length - 1];
    if (last.text === "*") return null; // SELECT * / t.*
    const nameTok = (t: Token) => t.text.toLowerCase();
    // Explicit alias: ... AS name
    const asIdx = item.findIndex((t, idx) => t.depth === 0 && up(t) === "AS" && idx === item.length - 2);
    if (asIdx !== -1 && (last.type === "word" || last.type === "quoted")) {
      names.push(nameTok(last));
      continue;
    }
    if (last.type !== "word" && last.type !== "quoted") continue;
    if (item.length === 1) {
      names.push(nameTok(last));
      continue;
    }
    const prev = item[item.length - 2];
    if (prev.text === ".") {
      names.push(nameTok(last));
    } else if (
      prev.type === "word" ||
      prev.type === "quoted" ||
      prev.type === "number" ||
      prev.type === "string" ||
      prev.text === ")"
    ) {
      // Implicit alias (`expr alias`).
      names.push(nameTok(last));
    }
  }
  return names;
}

export interface TableRef {
  /** As written in the query (qualified with '.' when it was). */
  name: string;
  alias: string | null;
}

const NOT_ALIAS = new Set([
  "WHERE", "ON", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "JOIN", "GROUP", "ORDER",
  "LIMIT", "UNION", "USING", "SET", "FETCH", "ROWS", "ROW", "HAVING", "OFFSET", "FOR",
  "WINDOW", "NATURAL", "OUTER", "LATERAL", "WITH", "EXCEPT", "INTERSECT", "PLAN", "OPTION",
]);

/** Tables read by FROM/JOIN anywhere in the query, in order, de-duplicated. */
export function referencedTables(sql: string): TableRef[] {
  const tokens = tokenize(sql);
  const out: TableRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = up(tokens[i]);
    if (w !== "FROM" && w !== "JOIN") continue;
    let j = i + 1;
    const first = tokens[j];
    if (!first || (first.type !== "word" && first.type !== "quoted")) continue;
    if (first.type === "word" && NOT_ALIAS.has(first.text.toUpperCase())) continue;
    // `EXTRACT(x FROM col)` / `TRIM(BOTH FROM x)`: the word before FROM is the
    // tell. A FROM inside such a call is followed by a column, not a table; the
    // only reliable guard is that FROM sits inside a function-call paren whose
    // opener is preceded by a word. Detect that.
    if (fromBelongsToFunction(tokens, i)) continue;
    const parts = [first.text];
    j++;
    while (tokens[j]?.text === "." && tokens[j + 1] && (tokens[j + 1].type === "word" || tokens[j + 1].type === "quoted")) {
      parts.push(tokens[j + 1].text);
      j += 2;
    }
    let alias: string | null = null;
    if (up(tokens[j]) === "AS" && tokens[j + 1]) {
      alias = tokens[j + 1].text;
    } else if (
      tokens[j] &&
      (tokens[j].type === "quoted" ||
        (tokens[j].type === "word" && !NOT_ALIAS.has(tokens[j].text.toUpperCase())))
    ) {
      alias = tokens[j].text;
    }
    const name = parts.join(".");
    if (!out.some((t) => t.name.toLowerCase() === name.toLowerCase() && t.alias === alias)) {
      out.push({ name, alias });
    }
  }
  return out;
}

function fromBelongsToFunction(tokens: Token[], fromIdx: number): boolean {
  const d = tokens[fromIdx].depth;
  if (d === 0) return false;
  // Walk back to the opening paren at depth d-1.
  for (let k = fromIdx - 1; k >= 0; k--) {
    if (tokens[k].text === "(" && tokens[k].depth === d - 1) {
      const before = up(tokens[k - 1]);
      return (
        before === "EXTRACT" ||
        before === "TRIM" ||
        before === "SUBSTRING" ||
        before === "OVERLAY"
      );
    }
  }
  return false;
}

/** The first FROM table of the main SELECT, or null when it is a subselect or
 *  cannot be determined. */
export function baseTable(sql: string): string | null {
  const tokens = tokenize(sql);
  const s = mainSelectIndex(tokens);
  if (s === -1) return null;
  for (let i = s + 1; i < tokens.length; i++) {
    if (tokens[i].depth === 0 && up(tokens[i]) === "FROM") {
      const first = tokens[i + 1];
      if (!first || (first.type !== "word" && first.type !== "quoted")) return null;
      const parts = [first.text];
      let j = i + 2;
      while (
        tokens[j]?.text === "." &&
        tokens[j + 1] &&
        (tokens[j + 1].type === "word" || tokens[j + 1].type === "quoted")
      ) {
        parts.push(tokens[j + 1].text);
        j += 2;
      }
      return parts.join(".");
    }
  }
  return null;
}

/** Only plain (optionally schema-qualified) identifiers may be spliced into the
 *  diagnostic COUNT/DISTINCT SQL. */
export function isSafeIdentifierPath(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$#]*(\.[A-Za-z_][A-Za-z0-9_$#]*){0,2}$/.test(name);
}

export interface ColumnRef {
  /** Table name or alias as written, null when unqualified. */
  qualifier: string | null;
  column: string;
}

const SQL_WORDS = new Set(
  (
    "SELECT FROM WHERE AND OR NOT NULL IS IN LIKE BETWEEN CASE WHEN THEN ELSE END AS ON JOIN INNER LEFT RIGHT FULL OUTER " +
    "CROSS GROUP BY ORDER ASC DESC LIMIT OFFSET FETCH FIRST NEXT ROWS ROW ONLY UNION ALL DISTINCT TOP CAST COALESCE EXISTS HAVING " +
    "WITH TIES TRUE FALSE INTERVAL DAY MONTH YEAR HOUR MINUTE SECOND TEXT VARCHAR NVARCHAR CHAR NCHAR INTEGER INT BIGINT SMALLINT " +
    "DATE TIME TIMESTAMP NUMERIC DECIMAL DOUBLE PRECISION FLOAT REAL BOOLEAN SKIP USING OVER PARTITION CURRENT_TIMESTAMP " +
    "CURRENT_DATE SYSDATE NOW CHARACTER SET OCTETS BLOB UNSIGNED SIGNED ESCAPE ANY SOME EXCEPT INTERSECT NATURAL LATERAL " +
    "FOR UPDATE PERCENT DUAL NVL IIF ABS ROUND UPPER LOWER TRIM LENGTH SUBSTRING REPLACE CONCAT"
  ).split(" ")
);

/** Qualified `a.b` references and unqualified identifiers of the query. The
 *  unqualified list is approximate: select-list aliases and function names are
 *  filtered heuristically. */
export function referencedColumns(sql: string): ColumnRef[] {
  const tokens = tokenize(sql);
  const out: ColumnRef[] = [];
  const seen = new Set<string>();
  const add = (q: string | null, c: string) => {
    const key = `${q?.toLowerCase() ?? ""}|${c.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ qualifier: q, column: c });
  };
  const aliasNames = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (up(tokens[i]) === "AS" && tokens[i + 1]) aliasNames.add(tokens[i + 1].text.toLowerCase());
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "word" && t.type !== "quoted") continue;
    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    if (prev?.text === ".") continue; // handled with its qualifier
    if (prev?.type === "param" || prev?.text === "::") continue;
    if (up(prev) === "AS") continue; // alias definition
    if (up(prev) === "FROM" || up(prev) === "JOIN") continue; // table
    if (next?.text === "(") continue; // function
    if (next?.text === "." && tokens[i + 2] && (tokens[i + 2].type === "word" || tokens[i + 2].type === "quoted")) {
      const col = tokens[i + 2];
      if (tokens[i + 3]?.text === "(") continue;
      if (col.text !== "*") add(t.text, col.text);
      continue;
    }
    if (t.type === "word" && SQL_WORDS.has(t.text.toUpperCase())) continue;
    if (t.type === "word" && NOT_ALIAS.has(t.text.toUpperCase())) continue;
    if (aliasNames.has(t.text.toLowerCase())) continue;
    // Table aliases / names right after FROM/JOIN tables are not columns.
    if (isTableNameOrAlias(tokens, i)) continue;
    add(null, t.text);
  }
  return out;
}

function isTableNameOrAlias(tokens: Token[], i: number): boolean {
  // `FROM a b`, `FROM a AS b`, `JOIN a.b c` : walk back over qualified names.
  let k = i - 1;
  // alias directly after a table path
  const prev = tokens[k];
  if (!prev) return false;
  if (prev.type === "word" || prev.type === "quoted") {
    // Implicit alias candidate: previous token is a table name preceded by FROM/JOIN
    let m = k;
    while (tokens[m - 1]?.text === "." && tokens[m - 2]) m -= 2;
    const before = up(tokens[m - 1]);
    return before === "FROM" || before === "JOIN";
  }
  return false;
}
