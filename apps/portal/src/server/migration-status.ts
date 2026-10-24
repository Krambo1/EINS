import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Compares the migration files shipped with this build against
 * `schema_migrations` (written by src/db/migrate.ts, version = file name
 * without `.sql`). Used by /api/health so "code deployed before the
 * migration ran" shows up as a failing probe instead of 500s on pages.
 *
 * The file list is read from disk once per process. When the folder is not
 * in the deployment bundle the result is `unknown` (never a failure): the
 * check then needs `outputFileTracingIncludes` for this route.
 */

let shipped: Promise<string[] | null> | null = null;

function shippedVersions(): Promise<string[] | null> {
  if (!shipped) {
    shipped = readdir(path.join(process.cwd(), "src/db/migrations"))
      .then((files) =>
        files
          .filter((f) => f.endsWith(".sql"))
          .map((f) => f.replace(/\.sql$/, ""))
          .sort()
      )
      .catch(() => null);
  }
  return shipped;
}

export type MigrationStatus = "ok" | "pending" | "unknown";

export async function migrationStatus(): Promise<MigrationStatus> {
  const files = await shippedVersions();
  if (!files || files.length === 0) return "unknown";
  const rows = (await db.execute(
    sql`SELECT version FROM schema_migrations`
  )) as unknown as Array<{ version: string }>;
  const applied = new Set(rows.map((r) => r.version));
  return files.every((v) => applied.has(v)) ? "ok" : "pending";
}
