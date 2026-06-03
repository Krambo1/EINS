import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { withClinicContext, schema, db } from "@/db/client";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";

/**
 * Query helpers that produce the numbers shown on the Dashboard,
 * Auswertung and Was-wäre-wenn screens.
 *
 * These all go through `withClinicContext` so RLS guarantees no cross-tenant
 * leak even if a caller forgets to filter. A few aggregations that need
 * previous-period comparisons use the superuser connection with an explicit
 * clinic_id filter — marked inline.
 */

export interface KpiSummary {
  leads: number;
  appointments: number;
  consultationsHeld: number;
  casesWon: number;
  spendEur: number;
  revenueEur: number;
  roas: number | null;
  costPerLead: number | null;
}

const emptySummary = (): KpiSummary => ({
  leads: 0,
  appointments: 0,
  consultationsHeld: 0,
  casesWon: 0,
  spendEur: 0,
  revenueEur: 0,
  roas: null,
  costPerLead: null,
});

/**
 * Uncached KPI summary. Called directly by `currentMonthSummary` and
 * `lastNDaysSummary` (both hit the live "as of right now" path — see the
 * cache-strategy notes in _cache.ts). The cached export `kpiSummary` is
 * the wrapper used by the dashboard's detail bundle.
 */
export async function kpiSummaryUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<KpiSummary> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        leads: sql<number>`coalesce(sum(${schema.kpiDaily.leads}), 0)`,
        appointments: sql<number>`coalesce(sum(${schema.kpiDaily.appointments}), 0)`,
        consultationsHeld: sql<number>`coalesce(sum(${schema.kpiDaily.consultationsHeld}), 0)`,
        casesWon: sql<number>`coalesce(sum(${schema.kpiDaily.casesWon}), 0)`,
        spendEur: sql<number>`coalesce(sum(${schema.kpiDaily.totalSpendEur}), 0)`,
        revenueEur: sql<number>`coalesce(sum(${schema.kpiDaily.revenueAttributedEur}), 0)`,
      })
      .from(schema.kpiDaily)
      .where(
        and(
          eq(schema.kpiDaily.clinicId, clinicId),
          gte(schema.kpiDaily.date, from.toISOString().slice(0, 10)),
          lte(schema.kpiDaily.date, to.toISOString().slice(0, 10))
        )
      );
    const r = rows[0];
    if (!r) return emptySummary();
    const spend = Number(r.spendEur);
    const revenue = Number(r.revenueEur);
    const leads = Number(r.leads);
    return {
      leads,
      appointments: Number(r.appointments),
      consultationsHeld: Number(r.consultationsHeld),
      casesWon: Number(r.casesWon),
      spendEur: spend,
      revenueEur: revenue,
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
      costPerLead: leads > 0 ? Number((spend / leads).toFixed(2)) : null,
    };
  });
}

/**
 * Cached version, read from the dashboard's detail bundle. Tagged
 * `kpi:<clinicId>`; flushed when the kpi-rebuild worker finishes.
 */
export const kpiSummary = cacheClinicQuery(
  "kpiSummary",
  kpiSummaryUncached,
  { dateArgs: [0, 1] }
);

/**
 * Short-TTL cached KPI summary for the dashboard's Trichter-Übersicht, which
 * owns its own range toggle (rFunnel). Switching a *different* card re-renders
 * the whole route; without caching, the funnel's current+prior queries would
 * re-hit Postgres on every unrelated toggle. SHORT_REVALIDATE_S keeps that
 * from happening while staying fresh within ~30s (and tag-busted by the
 * kpi-rebuild worker), closer to the funnel's original "within seconds"
 * intent than the 600s `kpiSummary` above.
 */
export const kpiSummaryFresh = cacheClinicQuery(
  "kpiSummaryFresh",
  kpiSummaryUncached,
  { dateArgs: [0, 1], revalidate: SHORT_REVALIDATE_S }
);

/** Daily rows for charts. Sorted ascending. Uncached implementation. */
async function kpiDailySeriesUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
) {
  return withClinicContext(clinicId, userId, async (tx) => {
    return await tx
      .select()
      .from(schema.kpiDaily)
      .where(
        and(
          eq(schema.kpiDaily.clinicId, clinicId),
          gte(schema.kpiDaily.date, from.toISOString().slice(0, 10)),
          lte(schema.kpiDaily.date, to.toISOString().slice(0, 10))
        )
      )
      .orderBy(schema.kpiDaily.date);
  });
}

/**
 * Cached version. The only callers today live in the dashboard and its
 * detail bundle, both of which are happy
 * with worker-bounded freshness.
 */
export const kpiDailySeries = cacheClinicQuery(
  "kpiDailySeries",
  kpiDailySeriesUncached,
  { dateArgs: [0, 1] }
);

export interface CampaignLiveSummary {
  platform: "meta" | "google";
  spendEur: number;
  leads: number;
  cplEur: number | null;
  lastSyncedAt: Date | null;
}

/**
 * "Werbebudget Live" — last 30 days rolled up per platform.
 * Reads campaign_snapshots directly (more granular than kpi_daily).
 */
export async function campaignLiveSummary(
  clinicId: string,
  userId: string,
  days = 30
): Promise<CampaignLiveSummary[]> {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        platform: schema.campaignSnapshots.platform,
        spendEur: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
        leads: sql<number>`coalesce(sum(${schema.campaignSnapshots.leads}), 0)`,
        lastSyncedAt: sql<Date>`max(${schema.campaignSnapshots.createdAt})`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, from.toISOString().slice(0, 10))
        )
      )
      .groupBy(schema.campaignSnapshots.platform);

    return rows.map((r) => {
      const leads = Number(r.leads);
      const spend = Number(r.spendEur);
      return {
        platform: r.platform as "meta" | "google",
        spendEur: spend,
        leads,
        cplEur: leads > 0 ? Number((spend / leads).toFixed(2)) : null,
        lastSyncedAt: r.lastSyncedAt ?? null,
      };
    });
  });
}

/** Goals for a period that overlaps `today`. Returns latest matching per metric. */
async function currentGoalsUncached(clinicId: string, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return withClinicContext(clinicId, userId, async (tx) => {
    return await tx
      .select()
      .from(schema.goals)
      .where(
        and(
          eq(schema.goals.clinicId, clinicId),
          lte(schema.goals.periodStart, today),
          gte(schema.goals.periodEnd, today)
        )
      )
      .orderBy(desc(schema.goals.createdAt));
  });
}

/**
 * Cached for SHORT_REVALIDATE_S. Goals are range-independent, so the dashboard
 * re-running this on every TimeRangeToggle is pure waste; they also change
 * rarely (set monthly in Einstellungen), so ~30s staleness is invisible.
 * Date columns on the returned rows are never read as Dates downstream (the
 * ordering is done in SQL), so the unstable_cache Date→string round-trip is
 * harmless here.
 */
export const currentGoals = cacheClinicQuery(
  "currentGoals",
  currentGoalsUncached,
  { revalidate: SHORT_REVALIDATE_S }
);

/**
 * Convenience: "current month so far" summary for the dashboard.
 *
 * NOTE: deliberately calls the uncached path — the dashboard is the
 * highest-trust freshness surface; user expects today's numbers within
 * seconds of a request landing, and the brief explicitly excludes this
 * from the cache list.
 */
export async function currentMonthSummary(clinicId: string, userId: string) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return kpiSummaryUncached(clinicId, userId, from, to);
}

/**
 * Last-N-days summary, used on the Auswertung "Letzte 30 Tage" toggle.
 * Uses the cached path — the auswertung surface is analytical and tolerant
 * of worker-bounded freshness.
 */
export async function lastNDaysSummary(
  clinicId: string,
  userId: string,
  days: number
) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return kpiSummary(clinicId, userId, from, to);
}

// ---------------------------------------------------------------
// Detail-mode extensions: comparison vs prior period + sparklines.
// ---------------------------------------------------------------

export interface KpiDelta {
  /** Percent change vs prior period (e.g. +0.12 = +12%). null if prior == 0. */
  leadsPct: number | null;
  appointmentsPct: number | null;
  casesWonPct: number | null;
  spendPct: number | null;
  revenuePct: number | null;
  roasPct: number | null;
}

export interface KpiSummaryWithComparison {
  current: KpiSummary;
  prior: KpiSummary;
  delta: KpiDelta;
}

function pctChange(current: number, prior: number): number | null {
  if (!Number.isFinite(prior) || prior === 0) return null;
  return (current - prior) / prior;
}

function buildDelta(cur: KpiSummary, prior: KpiSummary): KpiDelta {
  return {
    leadsPct: pctChange(cur.leads, prior.leads),
    appointmentsPct: pctChange(cur.appointments, prior.appointments),
    casesWonPct: pctChange(cur.casesWon, prior.casesWon),
    spendPct: pctChange(cur.spendEur, prior.spendEur),
    revenuePct: pctChange(cur.revenueEur, prior.revenueEur),
    roasPct:
      cur.roas != null && prior.roas != null && prior.roas !== 0
        ? (cur.roas - prior.roas) / prior.roas
        : null,
  };
}

/**
 * KPI summary AND prior-period summary for delta chips. Uncached body.
 * Period length is matched: prior covers the same number of days immediately
 * before `from`.
 */
export async function kpiSummaryWithComparisonUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<KpiSummaryWithComparison> {
  const lengthMs = to.getTime() - from.getTime();
  const priorTo = new Date(from.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - lengthMs);

  const [current, prior] = await Promise.all([
    kpiSummary(clinicId, userId, from, to),
    kpiSummary(clinicId, userId, priorFrom, priorTo),
  ]);
  return { current, prior, delta: buildDelta(current, prior) };
}

export const kpiSummaryWithComparison = cacheClinicQuery(
  "kpiSummaryWithComparison",
  kpiSummaryWithComparisonUncached,
  { dateArgs: [0, 1] }
);

export interface KpiSparklines {
  leads: number[];
  casesWon: number[];
  spendEur: number[];
  revenueEur: number[];
  roas: number[];
  noShowRate: number[];
  /** Parallel array of ISO date strings (YYYY-MM-DD), aligned with each metric. */
  dates: string[];
}

/**
 * Daily series + flat number arrays for fast sparkline rendering. Uncached body.
 * Returns the same row shape as kpiDailySeries plus an `aggregated.sparklines`
 * structure with one number array per metric, dense across the date range
 * (missing days fill with 0).
 */
export async function kpiDailySeriesWithSparklineUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<{
  rows: Awaited<ReturnType<typeof kpiDailySeries>>;
  sparklines: KpiSparklines;
}> {
  const rows = await kpiDailySeries(clinicId, userId, from, to);
  const byDate = new Map(rows.map((r) => [r.date, r]));

  const sparklines: KpiSparklines = {
    leads: [],
    casesWon: [],
    spendEur: [],
    revenueEur: [],
    roas: [],
    noShowRate: [],
    dates: [],
  };

  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const r = byDate.get(key);
    sparklines.dates.push(key);
    sparklines.leads.push(Number(r?.leads ?? 0));
    sparklines.casesWon.push(Number(r?.casesWon ?? 0));
    sparklines.spendEur.push(Number(r?.totalSpendEur ?? 0));
    sparklines.revenueEur.push(Number(r?.revenueAttributedEur ?? 0));
    sparklines.roas.push(Number(r?.roas ?? 0));
    sparklines.noShowRate.push(Number(r?.noShowRate ?? 0));
    cursor.setDate(cursor.getDate() + 1);
  }

  return { rows, sparklines };
}

export const kpiDailySeriesWithSparkline = cacheClinicQuery(
  "kpiDailySeriesWithSparkline",
  kpiDailySeriesWithSparklineUncached,
  { dateArgs: [0, 1] }
);

/**
 * Short-TTL cached sparkline series for the dashboard's Umsatz top-metric card
 * (revenue window + prior). Same rationale as kpiSummaryFresh: keeps an
 * unrelated TimeRangeToggle from re-running the revenue sparkline for an
 * unchanged window. The dashboard consumer reads only `.sparklines`
 * (string dates + number arrays), so it caches cleanly.
 */
export const kpiDailySeriesWithSparklineFresh = cacheClinicQuery(
  "kpiDailySeriesWithSparklineFresh",
  kpiDailySeriesWithSparklineUncached,
  { dateArgs: [0, 1], revalidate: SHORT_REVALIDATE_S }
);

/** No-show rate daily series — one row per day in range. Missing days = 0. */
export async function noShowRateSeries(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<Array<{ date: string; rate: number }>> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        date: schema.kpiDaily.date,
        noShowRate: schema.kpiDaily.noShowRate,
      })
      .from(schema.kpiDaily)
      .where(
        and(
          eq(schema.kpiDaily.clinicId, clinicId),
          gte(schema.kpiDaily.date, from.toISOString().slice(0, 10)),
          lte(schema.kpiDaily.date, to.toISOString().slice(0, 10))
        )
      )
      .orderBy(schema.kpiDaily.date);
    return rows.map((r) => ({
      date: r.date,
      rate: r.noShowRate ? Number(r.noShowRate) : 0,
    }));
  });
}

export interface NoShowWindow {
  /**
   * Appointment-weighted no-show rate across the window (0..1), or null when
   * no appointments with a computed rate fell in the window. Weighting by
   * appointment count (not a flat mean of daily rates) matches
   * `ruleNoShowSpike` and stops a single low-volume day with a freak rate
   * from dominating the headline.
   */
  rate: number | null;
  /** Appointments counted toward the rate (days that carry a computed rate). */
  appointments: number;
  /** Estimated no-shows in the window = round(Σ rate·appointments). */
  noShows: number;
  /**
   * Daily series for the sparkline, ascending by date. Days without a
   * computed rate render as 0 (mirrors the Auswertung No-Show-Quote chart).
   */
  series: Array<{ date: string; rate: number }>;
}

/**
 * No-show summary for a dashboard window: an appointment-weighted headline
 * rate plus the daily series for a sparkline. The returned series carries only
 * string dates + numbers (no Date objects), so it caches cleanly.
 */
async function noShowWindowUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<NoShowWindow> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        date: schema.kpiDaily.date,
        rate: schema.kpiDaily.noShowRate,
        appointments: schema.kpiDaily.appointments,
      })
      .from(schema.kpiDaily)
      .where(
        and(
          eq(schema.kpiDaily.clinicId, clinicId),
          gte(schema.kpiDaily.date, from.toISOString().slice(0, 10)),
          lte(schema.kpiDaily.date, to.toISOString().slice(0, 10))
        )
      )
      .orderBy(schema.kpiDaily.date);

    let appointments = 0;
    let weightedNoShows = 0;
    const series = rows.map((r) => {
      const rate = r.rate != null ? Number(r.rate) : null;
      const apps = r.appointments ?? 0;
      // Skip days without a computed rate or without appointments, exactly
      // like ruleNoShowSpike — they carry no signal for the weighted rate.
      if (rate != null && apps > 0) {
        appointments += apps;
        weightedNoShows += rate * apps;
      }
      return { date: r.date, rate: rate ?? 0 };
    });

    return {
      rate: appointments > 0 ? weightedNoShows / appointments : null,
      appointments,
      noShows: Math.round(weightedNoShows),
      series,
    };
  });
}

/**
 * Cached for SHORT_REVALIDATE_S. The No-Show-Quote card owns its own range
 * toggle (rNoShow); caching per (clinic, window) means switching a *different*
 * dashboard card no longer re-runs this query, while toggling the No-Show card
 * itself is a legitimate cache miss (new window). Tag-busted by the kpi worker.
 */
export const noShowWindow = cacheClinicQuery(
  "noShowWindow",
  noShowWindowUncached,
  { dateArgs: [0, 1], revalidate: SHORT_REVALIDATE_S }
);

/**
 * Superuser-scoped helper for worker jobs (SLA, monthly report) that run
 * outside a user context.
 */
export async function kpiSummaryAdmin(
  clinicId: string,
  from: Date,
  to: Date
): Promise<KpiSummary> {
  const rows = await db
    .select({
      leads: sql<number>`coalesce(sum(${schema.kpiDaily.leads}), 0)`,
      appointments: sql<number>`coalesce(sum(${schema.kpiDaily.appointments}), 0)`,
      consultationsHeld: sql<number>`coalesce(sum(${schema.kpiDaily.consultationsHeld}), 0)`,
      casesWon: sql<number>`coalesce(sum(${schema.kpiDaily.casesWon}), 0)`,
      spendEur: sql<number>`coalesce(sum(${schema.kpiDaily.totalSpendEur}), 0)`,
      revenueEur: sql<number>`coalesce(sum(${schema.kpiDaily.revenueAttributedEur}), 0)`,
    })
    .from(schema.kpiDaily)
    .where(
      and(
        eq(schema.kpiDaily.clinicId, clinicId),
        gte(schema.kpiDaily.date, from.toISOString().slice(0, 10)),
        lte(schema.kpiDaily.date, to.toISOString().slice(0, 10))
      )
    );
  const r = rows[0];
  if (!r) return emptySummary();
  const spend = Number(r.spendEur);
  const revenue = Number(r.revenueEur);
  const leads = Number(r.leads);
  return {
    leads,
    appointments: Number(r.appointments),
    consultationsHeld: Number(r.consultationsHeld),
    casesWon: Number(r.casesWon),
    spendEur: spend,
    revenueEur: revenue,
    roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
    costPerLead: leads > 0 ? Number((spend / leads).toFixed(2)) : null,
  };
}
