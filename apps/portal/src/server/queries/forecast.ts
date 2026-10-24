import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema, withClinicContext } from "@/db/client";
import { canonicalSource, type ForecastSource } from "@/lib/sources";

/**
 * Query inputs for the cashflow forecast engine.
 *
 * These helpers all live here (single file) instead of being scattered
 * across attribution/lifecycle because the engine treats them as one
 * coherent snapshot and re-running individual queries with different
 * cutoffs would silently bias the bootstrap.
 *
 * Tenant safety: the worker path uses `db` directly (no userId, runs after
 * cron, RLS is bypassed by the superuser connection). The read-path used
 * by the UI (`getLatestSnapshot`) goes through `withClinicContext` so the
 * normal RLS guarantees apply.
 *
 * Sample-size discipline: bootstraps over per-stage rates need a minimum
 * cell count to be meaningful. The engine handles per-stage fallbacks; the
 * queries here always return what the data has and never lie about size.
 */

// ---------------------------------------------------------------
// Forecast-relevant stages.
// ---------------------------------------------------------------
// Stages that are "in flight" toward gewonnen. We treat:
//   - 'neu' / 'termin_vereinbart' / 'beratung_erschienen'
//     as open pipeline (forecastable).
//   - 'behandelt' as "treatment done but invoice pending": still cash to
//     come in via the paid series.
//   - 'no_show' as recyclable (count it as if it bounced back to 'neu',
//     with no urgency premium).
//   - 'gewonnen' / 'verloren' / 'spam' as terminal (not open).
// Seit Migration 0046 gibt es keine 'qualifiziert'-Stage mehr.
export const FORECAST_OPEN_STAGES = [
  "neu",
  "termin_vereinbart",
  "beratung_erschienen",
  "behandelt",
  "no_show",
] as const;
export type ForecastStage = (typeof FORECAST_OPEN_STAGES)[number];

export interface OpenPipelineRow {
  requestId: string;
  treatmentId: string | null;
  stage: ForecastStage;
  source: ForecastSource;
  daysInPipeline: number;
  /** AI score 0..100, used as a soft Bayesian prior in the engine. */
  aiScore: number | null;
}

export interface StageRateRow {
  stage: ForecastStage;
  /** Historical wins divided by all closures (won + lost + spam excluded). */
  closeRate: number;
  /** Number of historical observations behind this rate. */
  sampleSize: number;
}

export interface StageDurationRow {
  stage: ForecastStage;
  /** Days from createdAt to wonAt for historical won rows that *passed through*
   *  this stage. The engine samples from this empirical distribution. */
  samples: number[];
}

export interface TreatmentRevenueRow {
  treatmentId: string;
  treatmentName: string;
  median: number;
  /** Number of won rows feeding the median. <3 = use clinic-wide fallback. */
  sampleSize: number;
}

export interface ForecastInputs {
  /** Total won deals all-time. Drives the cold-start gate. */
  totalWon: number;
  openPipeline: OpenPipelineRow[];
  stageCloseRates: StageRateRow[];
  /** Median time-to-win in days, grouped by stage of origin. */
  stageDurations: StageDurationRow[];
  /** Empirical DSO sample (days from wonAt → first InvoicePaid). */
  dsoDays: number[];
  /** Per-treatment revenue medians. */
  treatmentRevenue: TreatmentRevenueRow[];
  /** Clinic-wide median revenue across all won deals (fallback for treatments
   *  with no won history when the engine surfaces them as excluded). */
  clinicMedianRevenue: number;
}

/**
 * Pull every input the engine needs in a single coordinated read. Returns
 * raw, un-bootstrapped data; the engine handles the Monte Carlo. Worker
 * uses superuser `db` (bypasses RLS); pass an explicit `clinicId` filter
 * everywhere.
 */
export async function loadForecastInputs(
  clinicId: string
): Promise<ForecastInputs> {
  const [
    totalWon,
    openRows,
    stageCloseRows,
    stageDurationRows,
    dsoRows,
    treatmentRevenueRows,
    clinicMedianRow,
  ] = await Promise.all([
    countWonAllTime(clinicId),
    queryOpenPipeline(clinicId),
    queryStageCloseRates(clinicId),
    queryStageDurations(clinicId),
    queryDsoSamples(clinicId),
    queryTreatmentRevenue(clinicId),
    queryClinicMedianRevenue(clinicId),
  ]);

  return {
    totalWon,
    openPipeline: openRows,
    stageCloseRates: stageCloseRows,
    stageDurations: stageDurationRows,
    dsoDays: dsoRows,
    treatmentRevenue: treatmentRevenueRows,
    clinicMedianRevenue: clinicMedianRow,
  };
}

/** Won Anfragen ever (cheap gate: below MIN_SAMPLE_WON nothing else is read). */
export async function countWonAllTime(clinicId: string): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
    })
    .from(schema.requests)
    .where(eq(schema.requests.clinicId, clinicId));
  return Number(row?.n ?? 0);
}

async function queryOpenPipeline(clinicId: string): Promise<OpenPipelineRow[]> {
  const rows = await db
    .select({
      id: schema.requests.id,
      treatmentId: schema.requests.treatmentId,
      status: schema.requests.status,
      source: schema.requests.source,
      utm: schema.requests.utm,
      createdAt: schema.requests.createdAt,
      aiScore: schema.requests.aiScore,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        sql`${schema.requests.status} IN ('neu','termin_vereinbart','beratung_erschienen','behandelt','no_show')`
      )
    );

  const now = Date.now();
  return rows.map((r) => ({
    requestId: r.id,
    treatmentId: r.treatmentId,
    stage: r.status as ForecastStage,
    source: canonicalSource(r.source, r.utm),
    daysInPipeline: Math.max(
      0,
      Math.floor((now - new Date(r.createdAt).getTime()) / 86_400_000)
    ),
    aiScore: r.aiScore,
  }));
}

/**
 * Per-stage close rate, derived empirically:
 *   for each historical request, find the deepest stage it passed
 *   through (via request_activities.kind='status_change' meta->>'to',
 *   or meta->>'derivedStatus' on older PVS rows that carry no 'to').
 *   Bucket on that deepest stage and compute won_count / total.
 *
 * For a 12-month window so the rates don't include stale pre-launch data;
 * still tenant-scoped via clinic_id.
 */
async function queryStageCloseRates(clinicId: string): Promise<StageRateRow[]> {
  const cutoff = new Date(Date.now() - 365 * 86_400_000);
  // For each request, compute the "highest" stage entered. The status order
  // determines depth; ties (request was directly created at e.g. termin_vereinbart)
  // are still credited to that stage.
  const rows = await db.execute(sql`
    WITH stage_depth AS (
      SELECT
        r.id AS request_id,
        r.status AS final_status,
        COALESCE(
          (
            -- Historische Stage-Tiefe: deepest stage entered. 'qualifiziert'
            -- existiert seit Migration 0046 nicht mehr; bestehende
            -- status_change-Activities mit 'qualifiziert' werden hier
            -- ignoriert (wer dort hängengeblieben ist, fällt zurück auf 'neu').
            SELECT COALESCE(a.meta->>'to', a.meta->>'derivedStatus')
            FROM request_activities a
            WHERE a.request_id = r.id
              AND a.kind = 'status_change'
              AND COALESCE(a.meta->>'to', a.meta->>'derivedStatus') IN ('termin_vereinbart','beratung_erschienen','behandelt')
            ORDER BY
              CASE COALESCE(a.meta->>'to', a.meta->>'derivedStatus')
                WHEN 'termin_vereinbart' THEN 1
                WHEN 'beratung_erschienen' THEN 2
                WHEN 'behandelt' THEN 3
              END DESC NULLS LAST,
              a.created_at DESC
            LIMIT 1
          ),
          'neu'
        ) AS deepest_stage
      FROM requests r
      WHERE r.clinic_id = ${clinicId}
        AND r.created_at >= ${cutoff.toISOString()}
        AND r.status NOT IN ('spam')
    )
    SELECT
      deepest_stage AS stage,
      COUNT(*) FILTER (WHERE final_status = 'gewonnen')::int AS won_count,
      COUNT(*)::int AS total
    FROM stage_depth
    GROUP BY deepest_stage
  `);

  const out: StageRateRow[] = [];
  for (const r of rows as unknown as Array<{
    stage: string;
    won_count: number;
    total: number;
  }>) {
    if (!isForecastStage(r.stage)) continue;
    out.push({
      stage: r.stage,
      closeRate: r.total > 0 ? r.won_count / r.total : 0,
      sampleSize: r.total,
    });
  }
  return out;
}

/**
 * Per-stage *time-to-win* distribution. For each historical won request,
 * we record (wonAt - entered_stage_at) for each stage it passed through.
 * If the stage entry isn't in request_activities (pre-status-tracking data),
 * we use createdAt for 'neu' only.
 *
 * Capped at the last 500 won rows so the bootstrap payload stays small and
 * doesn't drift with a multi-year history that no longer matches the
 * praxis's current rhythm.
 */
async function queryStageDurations(clinicId: string): Promise<StageDurationRow[]> {
  const rows = await db.execute(sql`
    WITH recent_wins AS (
      SELECT id, created_at, won_at
      FROM requests
      WHERE clinic_id = ${clinicId}
        AND status = 'gewonnen'
        AND won_at IS NOT NULL
      ORDER BY won_at DESC
      LIMIT 500
    ),
    stage_entries AS (
      SELECT
        rw.id AS request_id,
        rw.won_at,
        rw.created_at,
        'neu'::text AS stage,
        rw.created_at AS entered_at
      FROM recent_wins rw
      UNION ALL
      SELECT
        rw.id,
        rw.won_at,
        rw.created_at,
        COALESCE(a.meta->>'to', a.meta->>'derivedStatus') AS stage,
        MIN(a.created_at) AS entered_at
      FROM recent_wins rw
      JOIN request_activities a ON a.request_id = rw.id
      WHERE a.kind = 'status_change'
        AND COALESCE(a.meta->>'to', a.meta->>'derivedStatus') IN ('termin_vereinbart','beratung_erschienen','behandelt','no_show')
      GROUP BY rw.id, rw.won_at, rw.created_at, COALESCE(a.meta->>'to', a.meta->>'derivedStatus')
    )
    SELECT
      stage,
      EXTRACT(EPOCH FROM (won_at - entered_at)) / 86400.0 AS days
    FROM stage_entries
    WHERE won_at IS NOT NULL AND entered_at IS NOT NULL
  `);

  const buckets = new Map<ForecastStage, number[]>();
  for (const r of rows as unknown as Array<{ stage: string; days: number }>) {
    if (!isForecastStage(r.stage)) continue;
    const days = Math.max(0, Number(r.days));
    if (!Number.isFinite(days)) continue;
    const arr = buckets.get(r.stage) ?? [];
    arr.push(days);
    buckets.set(r.stage, arr);
  }
  return Array.from(buckets.entries()).map(([stage, samples]) => ({
    stage,
    samples,
  }));
}

/**
 * Empirical DSO distribution (days from wonAt → InvoicePaid). The InvoicePaid
 * event lives in pvs_event_log keyed by pvsAppointmentId, joined to the
 * request that holds the same pvsAppointmentId.
 *
 * Recent 500 InvoicePaid events. Returns days as fractional numbers (a
 * same-day payment shows up as 0).
 */
async function queryDsoSamples(clinicId: string): Promise<number[]> {
  const rows = await db.execute(sql`
    SELECT
      EXTRACT(EPOCH FROM (
        (pel.payload->>'paidAt')::timestamptz - r.won_at
      )) / 86400.0 AS dso_days
    FROM pvs_event_log pel
    JOIN requests r
      ON r.clinic_id = pel.clinic_id
     AND r.pvs_appointment_id = pel.payload->>'pvsAppointmentId'
    WHERE pel.clinic_id = ${clinicId}
      AND pel.kind = 'InvoicePaid'
      AND r.won_at IS NOT NULL
      AND pel.payload ? 'paidAt'
      AND pel.payload ? 'pvsAppointmentId'
    ORDER BY pel.occurred_at DESC
    LIMIT 500
  `);

  const samples: number[] = [];
  for (const r of rows as unknown as Array<{ dso_days: number }>) {
    const d = Number(r.dso_days);
    if (Number.isFinite(d) && d >= 0) samples.push(d);
  }
  return samples;
}

async function queryTreatmentRevenue(
  clinicId: string
): Promise<TreatmentRevenueRow[]> {
  // Median per treatment in SQL (percentile_cont(0.5) = mean of the two
  // middle values, same as the old JS median) instead of loading every won
  // row into the function.
  const rows = await db
    .select({
      treatmentId: schema.requests.treatmentId,
      treatmentName: sql<string | null>`min(${schema.treatments.name})`,
      median: sql<number>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${schema.requests.convertedRevenueEur})::float8`,
      sampleSize: sql<number>`count(*)::int`,
    })
    .from(schema.requests)
    .leftJoin(
      schema.treatments,
      eq(schema.requests.treatmentId, schema.treatments.id)
    )
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        eq(schema.requests.status, "gewonnen"),
        isNotNull(schema.requests.treatmentId),
        isNotNull(schema.requests.convertedRevenueEur),
        gte(schema.requests.convertedRevenueEur, "0.01")
      )
    )
    .groupBy(schema.requests.treatmentId);

  return rows
    .filter((r) => r.treatmentId)
    .map((r) => ({
      treatmentId: r.treatmentId as string,
      treatmentName: r.treatmentName ?? "Behandlung",
      median: Number(r.median),
      sampleSize: Number(r.sampleSize),
    }));
}

async function queryClinicMedianRevenue(clinicId: string): Promise<number> {
  const [row] = await db
    .select({
      median: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${schema.requests.convertedRevenueEur})::float8`,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        eq(schema.requests.status, "gewonnen"),
        isNotNull(schema.requests.convertedRevenueEur),
        gte(schema.requests.convertedRevenueEur, "0.01")
      )
    );
  return row?.median != null ? Number(row.median) : 0;
}

// ---------------------------------------------------------------
// Snapshot read-path (UI). Goes through RLS so multi-tenant safety holds.
// ---------------------------------------------------------------
export interface ForecastSnapshotRow {
  snapshotDate: string; // YYYY-MM-DD
  horizonDays: number;
  weeklyBuckets: unknown; // typed in engine.ts; passed through as-is
  topKpis: unknown;
  sampleSizeWon: number;
  openRequestCount: number;
  excludedRequestCount: number;
  createdAt: Date;
}

export async function getLatestSnapshot(
  clinicId: string,
  userId: string
): Promise<ForecastSnapshotRow | null> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [row] = await tx
        .select({
          snapshotDate: schema.forecastSnapshots.snapshotDate,
          horizonDays: schema.forecastSnapshots.horizonDays,
          weeklyBuckets: schema.forecastSnapshots.weeklyBuckets,
          topKpis: schema.forecastSnapshots.topKpis,
          sampleSizeWon: schema.forecastSnapshots.sampleSizeWon,
          openRequestCount: schema.forecastSnapshots.openRequestCount,
          excludedRequestCount: schema.forecastSnapshots.excludedRequestCount,
          createdAt: schema.forecastSnapshots.createdAt,
        })
        .from(schema.forecastSnapshots)
        .where(eq(schema.forecastSnapshots.clinicId, clinicId))
        .orderBy(desc(schema.forecastSnapshots.snapshotDate))
        .limit(1);
      return row
        ? {
            snapshotDate: row.snapshotDate,
            horizonDays: row.horizonDays,
            weeklyBuckets: row.weeklyBuckets,
            topKpis: row.topKpis,
            sampleSizeWon: row.sampleSizeWon,
            openRequestCount: row.openRequestCount,
            excludedRequestCount: row.excludedRequestCount,
            createdAt: row.createdAt,
          }
        : null;
    },
    "forecast:latest"
  );
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------
function isForecastStage(s: string): s is ForecastStage {
  return (FORECAST_OPEN_STAGES as readonly string[]).includes(s);
}
