/**
 * Bootstrap Monte-Carlo cashflow forecast engine.
 *
 * Inputs come from `src/server/queries/forecast.ts` as raw historical data;
 * this module is pure (no DB, no server-only) so it can be unit-tested with
 * fixed seeds.
 *
 * Output: 13 weekly buckets with p10/p50/p90 percentiles for two series:
 *   - "booked" : revenue at the moment the request is won (status='gewonnen')
 *   - "paid"   : revenue at the moment the InvoicePaid event lands
 *                (paidAt = wonAt + DSO sample)
 *
 * Cold-start gate: caller checks `totalWon >= MIN_SAMPLE_WON` before storing
 * the snapshot; the engine itself doesn't refuse to run, so the worker can
 * still pre-compute a stub.
 *
 * Why bootstrap and not closed-form? Stage close rates are noisy at small
 * sample sizes; bootstrap honestly widens the band when the praxis has only
 * 30-50 wins, and narrows it as the sample grows. This is what makes the
 * "zu 90% zutreffend"-Versprechen out of Cluster D defensible: the chart
 * never *claims* false precision.
 */

import type {
  ForecastInputs,
  ForecastStage,
  OpenPipelineRow,
  StageDurationRow,
  StageRateRow,
  TreatmentRevenueRow,
} from "@/server/queries/forecast";

export const FORECAST_HORIZON_WEEKS = 13;
export const FORECAST_HORIZON_DAYS = FORECAST_HORIZON_WEEKS * 7;
export const MIN_SAMPLE_WON = 30;
const DEFAULT_RESAMPLES = 500;

// Stage-level fallback multipliers: when no empirical time-to-win sample
// exists for a stage, we approximate remaining days as
// `medianTotalCycle * stageMultiplier`. These are conservative defaults
// only used at cold start.
const STAGE_REMAINING_MULTIPLIER: Record<ForecastStage, number> = {
  neu: 1.0,
  qualifiziert: 0.8,
  termin_vereinbart: 0.5,
  beratung_erschienen: 0.25,
  behandelt: 0.05,
  no_show: 0.85,
};

// AI score gives a soft Bayesian nudge on top of the empirical stage rate.
// We multiply the stage rate by this factor; clamp the result to [0, 1].
// Effect is muted (0.85x..1.15x) so an absent or stale AI score doesn't
// dominate the empirical signal.
function aiMultiplier(score: number | null): number {
  if (score == null) return 1.0;
  if (score >= 75) return 1.15;
  if (score >= 50) return 1.05;
  if (score >= 25) return 0.95;
  return 0.85;
}

export interface WeeklyBucket {
  /** Monday of the week, ISO YYYY-MM-DD. */
  weekStart: string;
  booked: { p10: number; p50: number; p90: number };
  paid: { p10: number; p50: number; p90: number };
}

export interface ForecastTopKpis {
  /** Sum of [P_close × E[revenue]] over all forecastable open requests. */
  pipelineValueEur: number;
  /** Expected booked cash in the next 30 / 60 / 90 days (p50 of bookings). */
  expectedBooked30dEur: number;
  expectedBooked60dEur: number;
  expectedBooked90dEur: number;
  /** Same for paid cash. */
  expectedPaid30dEur: number;
  expectedPaid60dEur: number;
  expectedPaid90dEur: number;
}

export interface ForecastOutput {
  weeklyBuckets: WeeklyBucket[];
  topKpis: ForecastTopKpis;
  /** Open requests that contributed to the forecast. */
  forecastedRequestCount: number;
  /** Open requests skipped because their treatment has zero won-history.
   *  UI surfaces this as "N nicht prognostiziert". */
  excludedRequestCount: number;
}

export interface RunForecastOptions {
  resamples?: number;
  /** Anchor point. Defaults to now(). Pass an explicit date in tests. */
  asOf?: Date;
  /** Seedable PRNG for deterministic tests. Defaults to Math.random. */
  rng?: () => number;
}

export function runForecast(
  inputs: ForecastInputs,
  opts: RunForecastOptions = {}
): ForecastOutput {
  const resamples = opts.resamples ?? DEFAULT_RESAMPLES;
  const asOf = opts.asOf ?? new Date();
  const rng = opts.rng ?? Math.random;

  // ---------- Pre-compute lookups ----------
  const stageRate = new Map<ForecastStage, StageRateRow>();
  for (const r of inputs.stageCloseRates) stageRate.set(r.stage, r);

  const stageDuration = new Map<ForecastStage, StageDurationRow>();
  for (const r of inputs.stageDurations) stageDuration.set(r.stage, r);

  const treatmentRevenue = new Map<string, TreatmentRevenueRow>();
  for (const r of inputs.treatmentRevenue) treatmentRevenue.set(r.treatmentId, r);

  // Forecastable vs excluded:
  //   excluded = open requests with no treatment_id, or treatment_id with
  //   zero won-history (no revenue median). UI surfaces them, engine skips.
  const forecastable: OpenPipelineRow[] = [];
  let excluded = 0;
  for (const row of inputs.openPipeline) {
    if (!row.treatmentId || !treatmentRevenue.has(row.treatmentId)) {
      excluded++;
      continue;
    }
    forecastable.push(row);
  }

  // Median total cycle time across all stage-durations samples, used as the
  // multiplier base for stages with no empirical entry data.
  const allDurationSamples = inputs.stageDurations.flatMap((r) => r.samples);
  const medianCycleDays = allDurationSamples.length > 0 ? median(allDurationSamples) : 30;

  // ---------- Pipeline value (deterministic, no Monte Carlo) ----------
  // This is the *expected* sum, not a draw. Shown as the single "Pipeline-Wert
  // heute"-KPI above the chart.
  let pipelineValueEur = 0;
  for (const r of forecastable) {
    const baseRate = stageRate.get(r.stage)?.closeRate ?? 0;
    const p = clamp01(baseRate * aiMultiplier(r.aiScore));
    const revenue = treatmentRevenue.get(r.treatmentId!)?.median ?? 0;
    pipelineValueEur += p * revenue;
  }

  // ---------- Bootstrap loop ----------
  // For each resample we walk every forecastable open request, sample a
  // close outcome and (if won) a close week and a paid week, then
  // accumulate revenue into weekly buckets. After N resamples we sort each
  // bucket's draws and take p10/p50/p90.
  const bookedDraws: number[][] = Array.from(
    { length: FORECAST_HORIZON_WEEKS },
    () => new Array(resamples).fill(0)
  );
  const paidDraws: number[][] = Array.from(
    { length: FORECAST_HORIZON_WEEKS },
    () => new Array(resamples).fill(0)
  );

  // Anchor: bucket boundaries are calendar weeks (Mon-based). Week 0 = the
  // week containing `asOf`. A close that happens "in 5 days" lands in week 0
  // or week 1 depending on the day-of-week of `asOf`.
  const weekStarts = buildWeekStarts(asOf, FORECAST_HORIZON_WEEKS);

  for (let s = 0; s < resamples; s++) {
    for (const r of forecastable) {
      const baseRate = stageRate.get(r.stage)?.closeRate ?? 0;
      const pWin = clamp01(baseRate * aiMultiplier(r.aiScore));
      if (rng() >= pWin) continue;

      // Sample remaining days from the stage's empirical distribution, or
      // fall back to a fraction of the median cycle if no samples exist.
      const duration = stageDuration.get(r.stage);
      const remainingDays =
        duration && duration.samples.length >= 3
          ? sampleFrom(duration.samples, rng)
          : medianCycleDays * STAGE_REMAINING_MULTIPLIER[r.stage];

      // Convert to a bucket index (0..12). Anything past the horizon is dropped
      // since the UI only shows 13 weeks; for KPI sums, we still count it
      // via the 90d horizon, see KPI loop below.
      const closeDate = addDays(asOf, remainingDays);
      const wIdx = bucketIndex(weekStarts, closeDate);
      const revenue = treatmentRevenue.get(r.treatmentId!)?.median ?? 0;
      if (wIdx >= 0 && wIdx < FORECAST_HORIZON_WEEKS) {
        bookedDraws[wIdx][s] += revenue;
      }

      // Paid: shift by a sampled DSO. Empty DSO sample → 0 days (booked === paid).
      const dsoDays =
        inputs.dsoDays.length >= 3 ? sampleFrom(inputs.dsoDays, rng) : 0;
      const paidDate = addDays(closeDate, dsoDays);
      const pIdx = bucketIndex(weekStarts, paidDate);
      if (pIdx >= 0 && pIdx < FORECAST_HORIZON_WEEKS) {
        paidDraws[pIdx][s] += revenue;
      }
    }
  }

  // Sort each bucket's draws once, take percentiles.
  const weeklyBuckets: WeeklyBucket[] = weekStarts.map((weekStart, i) => {
    const bSorted = bookedDraws[i].sort((a, b) => a - b);
    const pSorted = paidDraws[i].sort((a, b) => a - b);
    return {
      weekStart: isoDate(weekStart),
      booked: {
        p10: percentile(bSorted, 0.1),
        p50: percentile(bSorted, 0.5),
        p90: percentile(bSorted, 0.9),
      },
      paid: {
        p10: percentile(pSorted, 0.1),
        p50: percentile(pSorted, 0.5),
        p90: percentile(pSorted, 0.9),
      },
    };
  });

  // ---------- Top KPIs ----------
  const topKpis: ForecastTopKpis = {
    pipelineValueEur: round2(pipelineValueEur),
    expectedBooked30dEur: sumP50Window(weeklyBuckets, 30, "booked"),
    expectedBooked60dEur: sumP50Window(weeklyBuckets, 60, "booked"),
    expectedBooked90dEur: sumP50Window(weeklyBuckets, 90, "booked"),
    expectedPaid30dEur: sumP50Window(weeklyBuckets, 30, "paid"),
    expectedPaid60dEur: sumP50Window(weeklyBuckets, 60, "paid"),
    expectedPaid90dEur: sumP50Window(weeklyBuckets, 90, "paid"),
  };

  return {
    weeklyBuckets,
    topKpis,
    forecastedRequestCount: forecastable.length,
    excludedRequestCount: excluded,
  };
}

// ============================================================
// Small numerical helpers
// ============================================================

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
  return round2(sortedAsc[idx]);
}

function sampleFrom(arr: number[], rng: () => number): number {
  return arr[Math.floor(rng() * arr.length)];
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + Math.round(days));
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Monday of the week containing `d`, in UTC. We pick Monday so weekly
 * buckets line up with how German praxen think about their week (Mo-Fr).
 */
function mondayOf(d: Date): Date {
  const out = new Date(d.getTime());
  const dow = out.getUTCDay(); // 0 = Sunday
  const offset = (dow + 6) % 7; // Mon=0, Sun=6
  out.setUTCDate(out.getUTCDate() - offset);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function buildWeekStarts(asOf: Date, weeks: number): Date[] {
  const base = mondayOf(asOf);
  return Array.from({ length: weeks }, (_, i) => addDays(base, i * 7));
}

function bucketIndex(weekStarts: Date[], date: Date): number {
  // Find the latest week_start <= date. Binary search is overkill for 13
  // entries; linear scan is fine and easier to read.
  let idx = -1;
  for (let i = 0; i < weekStarts.length; i++) {
    if (date.getTime() >= weekStarts[i].getTime()) idx = i;
    else break;
  }
  return idx;
}

function sumP50Window(
  buckets: WeeklyBucket[],
  horizonDays: number,
  series: "booked" | "paid"
): number {
  // Sum p50 contributions for buckets whose week_start lies within the
  // window. The last week may only partially fall inside; we still credit
  // its full p50 because the engine doesn't model intra-week distribution.
  const weeks = Math.ceil(horizonDays / 7);
  let total = 0;
  for (let i = 0; i < Math.min(weeks, buckets.length); i++) {
    total += buckets[i][series].p50;
  }
  return round2(total);
}
