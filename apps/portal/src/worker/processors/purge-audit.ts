import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { AUDIT_RETENTION_MONTHS } from "@/lib/constants";

/**
 * Delete audit rows older than AUDIT_RETENTION_MONTHS. Runs weekly.
 *
 * We keep audit forever for admin accounts by not filtering on that here —
 * law allows audit-log deletion after the retention window expires.
 */
export async function processPurgeAudit(): Promise<void> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - AUDIT_RETENTION_MONTHS);

  const result = await db.execute(
    sql`delete from ${schema.auditLog} where created_at < ${cutoff.toISOString()}`
  );
  // postgres-js returns a result whose `count` carries the affected rows.
  const count =
    (result as unknown as { count?: number }).count ??
    (result as unknown as { rowCount?: number }).rowCount ??
    0;
  console.log(`[purge-audit] deleted ${count} rows older than ${cutoff.toISOString()}`);
}
