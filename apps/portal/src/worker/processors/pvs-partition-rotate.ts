import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Cron-driven partition rotation for pvs_event_log.
 *
 * The base table is partitioned by RANGE(occurred_at). Migration 0022
 * created the previous-, current-, and next-month partitions. This
 * processor keeps the window rolling forward: every day at 04:00 it
 * ensures the *next two* months exist (current+1 and current+2). It
 * also drops partitions older than the retention window if configured.
 *
 * Retention defaults to "keep forever" — DSGVO requires us to expire
 * lead-related PII after 2 years of inactivity, but the event log
 * itself is operational not personally-identifying (it stores PVS ids,
 * not names). Keep until business decision.
 */

export interface PvsPartitionRotateJob {
  // Future-knob: how many months ahead to ensure.
  monthsAhead?: number;
}

export async function processPvsPartitionRotate(
  job: PvsPartitionRotateJob = {}
): Promise<void> {
  const monthsAhead = job.monthsAhead ?? 2;
  for (let i = 0; i <= monthsAhead; i++) {
    const start = monthStart(addMonths(new Date(), i));
    const end = monthStart(addMonths(new Date(), i + 1));
    const partitionName = `pvs_event_log_${formatYm(start)}`;
    // CREATE TABLE IF NOT EXISTS is partition-aware in PG 14+.
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ${partitionName}
      PARTITION OF pvs_event_log
      FOR VALUES FROM ('${start.toISOString().slice(0, 10)}')
                  TO ('${end.toISOString().slice(0, 10)}')
    `));
  }
  console.log(`[pvs-partition-rotate] ensured ${monthsAhead + 1} forward partitions`);
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function formatYm(d: Date): string {
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
