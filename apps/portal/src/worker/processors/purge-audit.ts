import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { AUDIT_RETENTION_MONTHS } from "@/lib/constants";

function affectedRows(result: unknown): number {
  return (
    (result as { count?: number }).count ??
    (result as { rowCount?: number }).rowCount ??
    0
  );
}

/**
 * Delete audit rows older than AUDIT_RETENTION_MONTHS. Runs weekly. Also prunes
 * the two Postgres-backed token/rate-limit stores that replaced Redis, since
 * those rows expire but are never deleted on the hot path.
 *
 * We keep audit forever for admin accounts by not filtering on that here —
 * law allows audit-log deletion after the retention window expires.
 */
export async function processPurgeAudit(): Promise<void> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - AUDIT_RETENTION_MONTHS);

  const auditResult = await db.execute(
    sql`delete from ${schema.auditLog} where created_at < ${cutoff.toISOString()}`
  );
  console.log(
    `[purge-audit] deleted ${affectedRows(auditResult)} audit rows older than ${cutoff.toISOString()}`
  );

  // Expired admin login / password-reset tokens (single-use; usually already
  // burned, but unconsumed ones linger past their 15-min TTL).
  const tokenResult = await db.execute(
    sql`delete from ${schema.adminTokens} where expires_at < now()`
  );
  console.log(`[purge-audit] deleted ${affectedRows(tokenResult)} expired admin tokens`);

  // Stale rate-limit buckets. The longest window is 1 hour, so anything older
  // than a day is certainly inactive and safe to drop.
  const rlResult = await db.execute(
    sql`delete from ${schema.rateLimits} where window_start < now() - interval '1 day'`
  );
  console.log(`[purge-audit] deleted ${affectedRows(rlResult)} stale rate-limit rows`);

  // Expired / long-consumed clinic magic-link rows (the old cron.ts comment
  // claimed this ran, but it was never wired — fold it into this weekly sweep).
  const { purgeExpiredMagicLinks } = await import("@/auth/magic-link");
  const magicLinks = await purgeExpiredMagicLinks();
  console.log(`[purge-audit] deleted ${magicLinks} expired magic-link rows`);
}
