import { and, asc, gt, isNull, lt, ne } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { reapplyLoggedEvent } from "@/server/pvs-events";
import { reenqueueStuckOutbox } from "@/server/ads-conversion-outbox";

/**
 * PVS apply sweep: safety net for pvs_event_log rows that were persisted but
 * never fully applied (applied_at IS NULL).
 *
 * How a row gets stuck: applyPvsEvent inserts the log row first, then links,
 * enqueues derive and stamps applied_at. If linking throws, the enqueue is
 * lost, or the process dies in between, the row stays unapplied. The agent's
 * retry normally finishes it (the dedupe branch re-runs the steps), but an
 * agent that gave up, was re-enrolled or lost its outbox never retries, and
 * the revenue would stay uncounted forever. This sweep finishes those rows.
 *
 * Also re-enqueues ads_conversion_outbox rows stuck in `pending` for > 30 min
 * (lost enqueue); nothing else does that.
 *
 * Suggested registration (NOT registered here; the owner of worker/index.ts and
 * the schedule registry wires it):
 *   queue: PVS_APPLY_SWEEP_QUEUE  = "pvs-apply-sweep"
 *   cron:  PVS_APPLY_SWEEP_CRON   = every 10 minutes
 *   handler: processPvsApplySweep
 *
 * Throws at the end when any row failed so pg-boss records the failure.
 */

export const PVS_APPLY_SWEEP_QUEUE = "pvs-apply-sweep";
export const PVS_APPLY_SWEEP_CRON = "*/10 * * * *";

const MIN_AGE_MS = 10 * 60 * 1000;
/** Rows older than this are left alone: a permanently failing row must not
 *  starve the 200-row window forever. They stay visible via applied_at NULL. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

export interface PvsApplySweepSummary {
  scanned: number;
  reapplied: number;
  failed: number;
  outbox: { found: number; enqueued: number; failed: number } | null;
}

export async function processPvsApplySweep(
  _job?: unknown
): Promise<PvsApplySweepSummary> {
  const now = Date.now();
  const rows = await db
    .select({ id: schema.pvsEventLog.id })
    .from(schema.pvsEventLog)
    .where(
      and(
        isNull(schema.pvsEventLog.appliedAt),
        lt(schema.pvsEventLog.ingestedAt, new Date(now - MIN_AGE_MS)),
        gt(schema.pvsEventLog.ingestedAt, new Date(now - MAX_AGE_MS)),
        // Quarantined behind a pending link: confirmPvsLinkActive owns these.
        ne(schema.pvsEventLog.linkStatusAtIngest, "pending")
      )
    )
    .orderBy(asc(schema.pvsEventLog.ingestedAt))
    .limit(BATCH_LIMIT);

  let reapplied = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const res = await reapplyLoggedEvent(row.id);
      if (res.ok && res.status !== "unconfirmed") reapplied++;
      else {
        failed++;
        console.error(
          `[pvs-apply-sweep] row ${row.id} not applied:`,
          res.ok ? res.status : res.reason
        );
      }
    } catch (err) {
      failed++;
      console.error(`[pvs-apply-sweep] row ${row.id} threw:`, err);
    }
  }

  let outbox: PvsApplySweepSummary["outbox"] = null;
  let outboxThrew = false;
  try {
    outbox = await reenqueueStuckOutbox(30);
  } catch (err) {
    outboxThrew = true;
    console.error("[pvs-apply-sweep] outbox re-enqueue failed:", err);
  }

  console.log(
    `[pvs-apply-sweep] scanned=${rows.length} reapplied=${reapplied} failed=${failed} outbox=${JSON.stringify(outbox)}`
  );

  if (failed > 0 || outboxThrew) {
    throw new Error(
      `pvs-apply-sweep: ${failed}/${rows.length} events failed to re-apply${outboxThrew ? "; outbox re-enqueue failed" : ""}`
    );
  }
  return { scanned: rows.length, reapplied, failed, outbox };
}
