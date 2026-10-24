import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notifyNewRequest } from "@/server/request-notify";
import { CLAIM_STALE_MINUTES } from "@/server/email-once";
import { runReviewRequestTick } from "@/worker/processors/review-request";
import { AUTO_PREV_PERIOD, runMonthlyReport } from "@/worker/processors/monthly-report";
import { runSlaCheck } from "@/worker/processors/sla-check";
import { berlinToday } from "@/worker/processors/berlin-days";
import { catchUpPvsCsvIngest } from "@/worker/processors/pvs-csv-ingest";
import { CronRun, activeClinicIds, checkCronAuth } from "../_lib/run";

/**
 * GET /api/cron/morning — daytime mail work without the pg-boss worker.
 *
 * Vercel cron once a day ~08:00 UTC (09:00 or 10:00 Berlin), inside the
 * patient mail window (Mon-Fri 09-18 Berlin, enforced again in the review
 * processor). Second and last cron entry, so it works on every Vercel plan.
 *   1. review-request mails due today (EINS Bewertungen)
 *   2. monthly report for the previous Berlin month: built once, owners
 *      mailed once (email_send_log ledger); later days of the month only
 *      retry recipients whose mail failed
 *   3. SLA bell for open requests past their deadline (last 7 days)
 *   4. catch-up for "Neue Anfrage" mails not delivered yet: every send
 *      failed (claim released, `new_request_notified_at` NULL again) or the
 *      claim is older than 15 min without `new_request_delivered_at` (the
 *      function died between claim and send, or no recipient existed)
 *   5. PVS CSV imports confirmed but not processed (C8): inline run lost or
 *      timed out; atomic claim, attempt limit, archived Praxen skipped
 * Archived Praxen are skipped: per-clinic steps use activeClinicIds(), the
 * SLA bell only reaches non-archived users (archiving archives them all) and
 * the catch-up query excludes archived clinics.
 *
 * Idempotent and safe next to the worker; JSON summary of every step.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;

  const run = new CronRun("morning");

  await run.step("review-request", () => runReviewRequestTick());

  // Days 1-7 of the Berlin month: the 1st does the work, the following days
  // only catch up after an outage or a failed mail. Later in the month a
  // newly invited user would otherwise get last month's report mail.
  if (Number(berlinToday().slice(8, 10)) <= 7) {
    // V4 Neben 9: a DB failure here is a failed step in the JSON summary,
    // not a framework 500.
    let clinics: string[] = [];
    await run.step("active-clinics", async () => {
      clinics = await activeClinicIds();
      return { clinics: clinics.length };
    });
    const outcomes: Record<string, number> = {};
    await run.perClinic("monthly-report", clinics, async (clinicId) => {
      const r = await runMonthlyReport({ clinicId, period: AUTO_PREV_PERIOD });
      outcomes[r] = (outcomes[r] ?? 0) + 1;
    });
    if (Object.keys(outcomes).length > 0) {
      console.log(JSON.stringify({ cron: "morning", step: "monthly-report", outcomes }));
    }
  }

  await run.step("sla-check", async () => ({ notified: await runSlaCheck() }));

  await run.step("new-request-catch-up", () => catchUpNewRequestMails());

  await run.step("pvs-csv-catch-up", () =>
    catchUpPvsCsvIngest({ budgetMs: Math.min(120_000, run.remainingMs()) })
  );

  return run.response();
}

/**
 * Window for the catch-up. 25 h, not 24 h: this cron runs once a day and
 * Vercel may start it late within the hour, so a 24 h window could miss a
 * request whose mail failed just after the previous run. Older rows were
 * backfilled by 0087 and are never mailed.
 */
const CATCH_UP_HOURS = 25;
const CATCH_UP_LIMIT = 200;

async function catchUpNewRequestMails(): Promise<Record<string, number>> {
  const rows = (await db.execute(sql`
    SELECT r.id
      FROM requests r
      JOIN clinics c ON c.id = r.clinic_id
     WHERE r.new_request_delivered_at IS NULL
       AND (r.new_request_notified_at IS NULL
            OR r.new_request_notified_at
               < now() - (${CLAIM_STALE_MINUTES}::int * interval '1 minute'))
       AND r.created_at > now() - (${CATCH_UP_HOURS}::int * interval '1 hour')
       AND c.archived_at IS NULL
     ORDER BY r.created_at
     LIMIT ${CATCH_UP_LIMIT}
  `)) as unknown as Array<{ id: string }>;
  const outcomes: Record<string, number> = { due: rows.length };
  for (const { id } of rows) {
    // Claims the row itself, never throws; null = unexpected error (logged).
    const r = await notifyNewRequest(id);
    const key = r?.status ?? "error";
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  return outcomes;
}
