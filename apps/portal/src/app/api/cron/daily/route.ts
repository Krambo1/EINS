import type { NextRequest } from "next/server";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { processRefreshOauth } from "@/worker/processors/refresh-oauth";
import { processSyncMeta } from "@/worker/processors/sync-meta";
import { processSyncGoogle } from "@/worker/processors/sync-google";
import { processKpiRebuild } from "@/worker/processors/kpi-rebuild";
import { processForecastSnapshot } from "@/worker/processors/forecast-snapshot";
import { processSyncReviewsGoogle } from "@/worker/processors/sync-reviews-google";
import { processSyncReviewsJameda } from "@/worker/processors/sync-reviews-jameda";
import { processAnomalyScan } from "@/worker/processors/anomaly-scan";
import { processAiScore } from "@/worker/processors/ai-score";
import { processPurgeAudit } from "@/worker/processors/purge-audit";
import { processPurgeRetention } from "@/worker/processors/purge-retention";
import { addDaysIso, berlinToday, berlinYesterday } from "@/worker/processors/berlin-days";
import { catchUpPvsCsvIngest } from "@/worker/processors/pvs-csv-ingest";
import { CronRun, activeClinicIds, checkCronAuth } from "../_lib/run";

/**
 * GET /api/cron/daily — nightly work without the pg-boss worker.
 *
 * Vercel cron, once a day ~03:00 UTC (vercel.json). Calls the worker's
 * processors directly, in dependency order:
 *   1. OAuth refresh + reconnect hints
 *   2. Meta / Google spend for Berlin "gestern"
 *   3. kpi_daily rebuild for today and the 7 days before (Berlin days):
 *      covers yesterday + today and heals late status changes (E-01)
 *   4. forecast snapshot, review-score syncs, anomaly scan
 *   5. Retention (L-4, lib/retention.ts): spam, click ids, archived
 *      Praxen, old unbooked Anfragen, sessions, tokens, send log. Daily.
 *   6. Sunday (Berlin): audit / token purge
 *   7. PVS CSV imports confirmed but not processed (C8, also in morning)
 * Patient and owner mails run in /api/cron/morning (daytime send window).
 *
 * Every step and every clinic is isolated; the JSON summary lists failures.
 * Safe to run twice and safe next to the worker: all steps are idempotent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Days rebuilt before today on every run (self-healing window). */
const KPI_BACKFILL_DAYS = 7;

export async function GET(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;

  const run = new CronRun("daily");
  // V4 Neben 9: inside a step, so a DB failure at the start still answers
  // with the JSON summary (the per-clinic steps then run for no clinic).
  let clinics: string[] = [];
  await run.step("active-clinics", async () => {
    clinics = await activeClinicIds();
    return { clinics: clinics.length };
  });
  const today = berlinToday();
  const yesterday = berlinYesterday();

  await run.step("refresh-oauth", () => processRefreshOauth());

  await run.perClinic("sync-meta", clinics, (clinicId) =>
    processSyncMeta({ clinicId, date: yesterday })
  );
  await run.perClinic("sync-google", clinics, (clinicId) =>
    processSyncGoogle({ clinicId, date: yesterday })
  );

  const from = addDaysIso(today, -KPI_BACKFILL_DAYS);
  await run.perClinic("kpi-rebuild", clinics, (clinicId) =>
    processKpiRebuild({ clinicId, from, to: today })
  );

  await run.perClinic("forecast-snapshot", clinics, (clinicId) =>
    processForecastSnapshot({ clinicId })
  );

  // Review-score syncs append a snapshot row; skip a platform that already
  // got one in the last 20 h (the worker may have run it), so the cron does
  // not double the history.
  await run.perClinic("sync-reviews-google", clinics, async (clinicId) => {
    if (await recentReviewSnapshot(clinicId, "google")) return;
    await processSyncReviewsGoogle({ clinicId });
  });
  await run.perClinic("sync-reviews-jameda", clinics, async (clinicId) => {
    if (await recentReviewSnapshot(clinicId, "jameda")) return;
    await processSyncReviewsJameda({ clinicId });
  });

  await run.perClinic("anomaly-scan", clinics, (clinicId) => processAnomalyScan({ clinicId }));

  // K-5 safety net: Anfragen the inline score after intake missed (timeout,
  // deploy mid-request). Idempotent, processAiScore skips scored rows.
  await run.step("ai-score-catch-up", () => scoreMissing());

  await run.step("purge-retention", () => processPurgeRetention());

  if (isBerlinSunday(today)) {
    await run.step("purge-audit", () => processPurgeAudit({ skipRetention: true }));
  }

  await run.step("pvs-csv-catch-up", () =>
    catchUpPvsCsvIngest({ budgetMs: Math.min(120_000, run.remainingMs()) })
  );

  return run.response();
}

/**
 * Unscored Anfragen of the last 7 days, oldest first, at most 100 / 60 s.
 * V4 Neben 7: archived Praxen are skipped like in the other steps.
 */
async function scoreMissing(): Promise<{ due: number; scored: number }> {
  const started = Date.now();
  const rows = await db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(
      and(
        isNull(schema.requests.aiScore),
        isNull(schema.clinics.archivedAt),
        gt(schema.requests.createdAt, new Date(Date.now() - 7 * 24 * 3600 * 1000))
      )
    )
    .orderBy(asc(schema.requests.createdAt))
    .limit(100);
  let scored = 0;
  for (const r of rows) {
    if (Date.now() - started > 60_000) break;
    try {
      await processAiScore({ requestId: r.id });
      scored += 1;
    } catch {
      // next run retries; the step result shows due > scored
    }
  }
  return { due: rows.length, scored };
}

async function recentReviewSnapshot(
  clinicId: string,
  platform: "google" | "jameda"
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.reviews.id })
    .from(schema.reviews)
    .where(
      and(
        eq(schema.reviews.clinicId, clinicId),
        eq(schema.reviews.platform, platform),
        gt(schema.reviews.recordedAt, new Date(Date.now() - 20 * 3600 * 1000))
      )
    )
    .limit(1);
  return Boolean(row);
}

function isBerlinSunday(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() === 0;
}
