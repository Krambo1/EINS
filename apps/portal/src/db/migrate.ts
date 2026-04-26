/**
 * Mini migration runner — applies every *.sql file in ./migrations in order,
 * skipping those already recorded in schema_migrations.
 *
 * Why not drizzle-kit? The schema has custom types (bytea, citext) and
 * hand-crafted RLS policies that are easier to express in raw SQL than
 * in Drizzle's migration generator.
 */

import "../lib/load-env";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => void 0 });
  const migrationsDir = path.join(process.cwd(), "src/db/migrations");

  try {
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

    const applied = new Set<string>(
      (await sql`SELECT version FROM schema_migrations`).map((r) => r.version)
    );

    let appliedCount = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        console.log(`· skip  ${version}`);
        continue;
      }
      const fullPath = path.join(migrationsDir, file);
      const body = await readFile(fullPath, "utf8");

      console.log(`→ apply ${version}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations(version) VALUES (${version})`;
      });
      appliedCount += 1;
    }

    console.log(
      appliedCount === 0
        ? "✓ already up to date"
        : `✓ applied ${appliedCount} migration(s)`
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
