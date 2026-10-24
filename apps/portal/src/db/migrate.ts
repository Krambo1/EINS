/**
 * Mini migration runner — applies every *.sql file in ./migrations in order,
 * skipping those already recorded in schema_migrations.
 *
 * Safe to run concurrently: a runner-wide advisory lock plus a per-file
 * transaction lock with a re-check, so two `db:migrate` runs never apply a
 * file twice. Each file runs in one transaction with its tracker row, except
 * files with CONCURRENTLY statements (comments ignored), which run statement
 * by statement and must be idempotent.
 *
 * Why not drizzle-kit? The schema has custom types (bytea, citext) and
 * hand-crafted RLS policies that are easier to express in raw SQL than
 * in Drizzle's migration generator.
 */

import "../lib/load-env";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  duplicatePrefixes,
  outOfOrder,
  requiresNoTransaction,
  splitSqlStatements,
} from "./migrate-sql";

/** Session lock: one runner at a time (two terminals, CI + local). */
const RUNNER_LOCK_KEY = 727274;
/** Per-file transaction lock: still serialises when the session lock cannot
 *  hold (transaction-mode pooler hands each transaction a different backend). */
const FILE_LOCK_KEY = 727275;
/** Prefixes that were already shipped twice; any other duplicate warns. */
const KNOWN_DUPLICATE_PREFIXES = new Set(["0015"]);

function usesPgBouncer(url: string): boolean {
  return /-pooler\./.test(url) || /[?&]pgbouncer=true\b/.test(url);
}

/**
 * Poll with pg_try_advisory_lock instead of blocking in pg_advisory_lock: a
 * session blocked inside a statement holds a transaction that
 * CREATE INDEX CONCURRENTLY in the other runner waits for, and Postgres then
 * kills one side with "deadlock detected".
 */
async function acquireRunnerLock(sql: postgres.Sql): Promise<void> {
  let announced = false;
  for (;;) {
    const [row] = await sql`SELECT pg_try_advisory_lock(${RUNNER_LOCK_KEY}) AS ok`;
    if (row?.ok) return;
    if (!announced) {
      console.log("… another migration run holds the lock, waiting");
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  // Prefer the direct (session-mode) endpoint: DDL and advisory locks belong
  // on a real backend, not behind a transaction-mode pooler.
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }
  const pooled = usesPgBouncer(url);

  const sql = postgres(url, {
    max: 1,
    onnotice: () => void 0,
    // PgBouncer in transaction mode has no prepared statements.
    prepare: !pooled,
  });
  const migrationsDir = path.join(process.cwd(), "src/db/migrations");

  try {
    if (pooled) {
      console.warn(
        "! DATABASE_URL points at a pooler: the runner-wide lock may not hold, " +
          "per-file locks still prevent double application. Set DATABASE_URL_DIRECT."
      );
    }
    await acquireRunnerLock(sql);

    // Bootstrap the tracker table (idempotent).
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const versions = files.map((f) => f.replace(/\.sql$/, ""));

    const applied = new Set<string>(
      (await sql`SELECT version FROM schema_migrations`).map((r) => r.version)
    );

    for (const prefix of duplicatePrefixes(versions, KNOWN_DUPLICATE_PREFIXES)) {
      console.warn(`! duplicate migration number ${prefix}: order between those files is alphabetical`);
    }
    const pending = versions.filter((v) => !applied.has(v));
    for (const v of outOfOrder(pending, applied)) {
      console.warn(`! ${v} is older than the newest applied migration; a fresh DB runs it in a different order`);
    }

    let appliedCount = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        console.log(`· skip  ${version}`);
        continue;
      }
      const body = await readFile(path.join(migrationsDir, file), "utf8");

      if (requiresNoTransaction(body)) {
        // CREATE INDEX CONCURRENTLY and friends refuse a transaction block,
        // and a multi-statement string counts as one. Run statement by
        // statement; such files must be idempotent (IF NOT EXISTS) so a
        // re-run after a failure is safe.
        console.log(`→ apply ${version} (no transaction)`);
        for (const statement of splitSqlStatements(body)) {
          await sql.unsafe(statement);
        }
        await sql`
          INSERT INTO schema_migrations(version) VALUES (${version})
          ON CONFLICT (version) DO NOTHING
        `;
        appliedCount += 1;
        continue;
      }

      // Atomic per file: body + tracker row commit together or not at all.
      // Re-check under the lock so a concurrent runner that got here first
      // is not applied twice.
      const didApply = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${FILE_LOCK_KEY})`;
        const done = await tx`SELECT 1 FROM schema_migrations WHERE version = ${version}`;
        if (done.length > 0) return false;
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations(version) VALUES (${version})`;
        return true;
      });
      if (didApply) {
        console.log(`→ apply ${version}`);
        appliedCount += 1;
      } else {
        console.log(`· skip  ${version} (applied by a concurrent run)`);
      }
    }

    console.log(
      appliedCount === 0
        ? "✓ already up to date"
        : `✓ applied ${appliedCount} migration(s)`
    );
  } finally {
    // Ending the connection releases the session lock as well.
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
