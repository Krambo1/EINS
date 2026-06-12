import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Cron-driven partition rotation for pvs_event_log.
 *
 * The base table is partitioned by RANGE(occurred_at). Migration 0022
 * created the previous-, current-, and next-month partitions. This
 * processor keeps the window rolling forward: every day at 04:00 it
 * ensures the next ~6 months exist. It also drops partitions older than
 * the retention window if configured.
 *
 * Why 6 months runway: the cron itself can stop (failed deploy, worker
 * outage, mistakenly disabled). A 2-month buffer makes that outage
 * invisible until events from the future fail to ingest — and PVS events
 * routinely carry occurredAt dates 30–90 days out (scheduled appointments,
 * recalls). 6 months gives ops time to notice + repair before any event
 * hits ENOENT-partition. The created partitions are cheap (empty tables).
 *
 * Retention defaults to "keep forever" — DSGVO requires us to expire
 * lead-related PII after 2 years of inactivity, but the event log
 * itself is operational not personally-identifying (it stores PVS ids,
 * not names). Keep until business decision.
 */

export interface PvsPartitionRotateJob {
  /** How many months ahead to ensure (default 6). */
  monthsAhead?: number;
}

export async function processPvsPartitionRotate(
  job: PvsPartitionRotateJob = {}
): Promise<void> {
  const monthsAhead = job.monthsAhead ?? 6;
  for (let i = 0; i <= monthsAhead; i++) {
    await ensurePartitionForMonthOffset(i);
  }
  console.log(`[pvs-partition-rotate] ensured ${monthsAhead + 1} forward partitions`);
}

/**
 * Ensure a partition exists for the month containing `target`. Idempotent.
 * Exposed so applyPvsEvent can self-heal when an event arrives for a date
 * outside the pre-created window (long gap in cron runs, far-future
 * occurredAt, etc.).
 *
 * IF NOT EXISTS on partitioned table is partition-aware in PG 14+ and
 * cheap on the rerun path.
 */
export async function ensurePartitionForMonth(target: Date): Promise<void> {
  const start = monthStart(target);
  const end = monthStart(addMonths(target, 1));
  const partitionName = `pvs_event_log_${formatYm(start)}`;
  // injection-reviewed (pentest L12): every interpolation here is internally
  // derived from a Date — partitionName is `pvs_event_log_${formatYm(start)}`
  // (→ YYYY_MM) and the FROM/TO bounds are ISO-date slices of computed month
  // starts. No caller-controlled value reaches this DDL, which cannot be
  // parameterised (a table identifier and partition bounds are not bindable).
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${partitionName}
    PARTITION OF pvs_event_log
    FOR VALUES FROM ('${start.toISOString().slice(0, 10)}')
                TO ('${end.toISOString().slice(0, 10)}')
  `));
}

async function ensurePartitionForMonthOffset(offset: number): Promise<void> {
  await ensurePartitionForMonth(addMonths(new Date(), offset));
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
