import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { withClinicContext, db, type dbApp } from "@/db/client";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";
import { adInquiriesByDay } from "./_ad-inquiries";
import { costPerQualified } from "./_qualified";
import { openQueueDailyInRangeWithComparison } from "./requests";
import {
  addIsoDays,
  berlinDay,
  berlinStartOfDay,
  priorDashboardWindow,
} from "@/lib/dashboard-range";

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
  /** Umsatz of the Anfragen that came in through a Meta or Google ad. */
  adRevenueEur: number;
  /** Werbeertrag: adRevenueEur ÷ spendEur. Umsatz from posts or Empfehlungen used no Werbebudget. */
  roas: number | null;
  /** Qualifizierte Anfragen from Meta or Google ads (_qualified.ts, _ad-inquiries.ts). */
  qualifiedAdLeads: number;
  /** Werbebudget ÷ qualifiedAdLeads (contract 2.11); null without Werbebudget or without one. */
  costPerQualifiedLead: number | null;
}

const emptySummary = (): KpiSummary => ({
  leads: 0,
  appointments: 0,
  consultationsHeld: 0,
  casesWon: 0,
  spendEur: 0,
  revenueEur: 0,
  adRevenueEur: 0,
  roas: null,
  qualifiedAdLeads: 0,
  costPerQualifiedLead: null,
});

// ---------------------------------------------------------------
// Live daily KPIs (Berlin calendar days)
// ---------------------------------------------------------------
//
// The dashboard used to read `kpi_daily`, which only the pg-boss worker fills
// (and only for "yesterday"). With the worker off every number stayed 0, and
// even with it on, today and every status change on an older Anfrage never
// showed up. Every column of `kpi_daily` is a plain aggregate of `requests`
// (by created_at) and `campaign_snapshots` (by snapshot_date), so we compute
// the same aggregates live, bucketed by the Berlin calendar day. Backed by
// `requests_created_idx (clinic_id, created_at)` and `campaign_snapshots_unique
// (clinic_id, snapshot_date, platform)`: one index range scan per window.
// `kpi_daily` stays as the worker/admin rollup; clinic-facing numbers never
// depend on it.

export interface LiveKpiDay {
  /** Berlin calendar date "YYYY-MM-DD". */
  date: string;
  leads: number;
  appointments: number;
  consultationsHeld: number;
  noShows: number;
  casesWon: number;
  revenueEur: number;
  spendEur: number;
  /** Qualifizierte Anfragen from Meta or Google ads that day. */
  qualifiedAdLeads: number;
  /** Umsatz of that day's Anfragen from Meta or Google ads. */
  adRevenueEur: number;
}

/** Sparse per-day rows (only days with requests or spend), ascending. */
async function selectLiveKpiDays(
  runner: typeof dbApp,
  clinicId: string,
  from: Date,
  to: Date
): Promise<LiveKpiDay[]> {
  const fromDate = berlinDay(from);
  const toDate = berlinDay(to);
  if (fromDate > toDate) return [];
  const start = berlinStartOfDay(fromDate);
  const endExclusive = berlinStartOfDay(addIsoDays(toDate, 1));
  const fromTs = start.toISOString();
  const endTs = endExclusive.toISOString();
  // The ad channel is decided by reportingChannel() in JS, so the qualified
  // ad Anfragen and their Umsatz come from their own grouped read
  // (_ad-inquiries.ts).
  const [result, adDays] = await Promise.all([
    runner.execute(sql`
    WITH r AS (
      SELECT
        (created_at AT TIME ZONE 'Europe/Berlin')::date AS d,
        count(*) FILTER (WHERE status <> 'spam')::int AS leads,
        count(*) FILTER (WHERE status IN ('termin_vereinbart','beratung_erschienen','behandelt','gewonnen'))::int AS appointments,
        count(*) FILTER (WHERE status IN ('beratung_erschienen','behandelt','gewonnen'))::int AS consultations_held,
        count(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
        count(*) FILTER (WHERE status = 'gewonnen')::int AS cases_won,
        coalesce(sum(converted_revenue_eur) FILTER (WHERE status = 'gewonnen'), 0)::float8 AS revenue
      FROM requests
      WHERE clinic_id = ${clinicId}
        AND created_at >= ${fromTs}::timestamptz
        AND created_at < ${endTs}::timestamptz
      GROUP BY 1
    ),
    s AS (
      SELECT snapshot_date AS d, coalesce(sum(spend_eur), 0)::float8 AS spend
      FROM campaign_snapshots
      WHERE clinic_id = ${clinicId}
        AND snapshot_date >= ${fromDate}::date
        AND snapshot_date <= ${toDate}::date
      GROUP BY 1
    )
    SELECT
      to_char(coalesce(r.d, s.d), 'YYYY-MM-DD') AS date,
      coalesce(r.leads, 0) AS leads,
      coalesce(r.appointments, 0) AS appointments,
      coalesce(r.consultations_held, 0) AS consultations_held,
      coalesce(r.no_shows, 0) AS no_shows,
      coalesce(r.cases_won, 0) AS cases_won,
      coalesce(r.revenue, 0) AS revenue,
      coalesce(s.spend, 0) AS spend
    FROM r FULL OUTER JOIN s ON s.d = r.d
    ORDER BY 1
  `),
    adInquiriesByDay(runner, clinicId, start, endExclusive),
  ]);
  const rows = result as unknown as Array<Record<string, string | number>>;
  const qualifiedByDate = new Map<string, number>();
  const adRevenueByDate = new Map<string, number>();
  for (const a of adDays) {
    qualifiedByDate.set(a.date, (qualifiedByDate.get(a.date) ?? 0) + a.qualified);
    adRevenueByDate.set(a.date, (adRevenueByDate.get(a.date) ?? 0) + a.revenueEur);
  }
  return rows.map((r) => ({
    date: String(r.date),
    leads: Number(r.leads),
    appointments: Number(r.appointments),
    consultationsHeld: Number(r.consultations_held),
    noShows: Number(r.no_shows),
    casesWon: Number(r.cases_won),
    revenueEur: Number(r.revenue),
    spendEur: Number(r.spend),
    qualifiedAdLeads: qualifiedByDate.get(String(r.date)) ?? 0,
    adRevenueEur: adRevenueByDate.get(String(r.date)) ?? 0,
  }));
}

/** Live per-day KPI rows through the RLS context. */
export async function liveKpiDays(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<LiveKpiDay[]> {
  return withClinicContext(
    clinicId,
    userId,
    (tx) => selectLiveKpiDays(tx, clinicId, from, to),
    "kpis:live-days"
  );
}

function summarize(days: LiveKpiDay[]): KpiSummary {
  if (days.length === 0) return emptySummary();
  let leads = 0;
  let appointments = 0;
  let consultationsHeld = 0;
  let casesWon = 0;
  let spend = 0;
  let revenue = 0;
  let adRevenue = 0;
  let qualifiedAdLeads = 0;
  for (const d of days) {
    leads += d.leads;
    appointments += d.appointments;
    consultationsHeld += d.consultationsHeld;
    casesWon += d.casesWon;
    spend += d.spendEur;
    revenue += d.revenueEur;
    adRevenue += d.adRevenueEur;
    qualifiedAdLeads += d.qualifiedAdLeads;
  }
  spend = Number(spend.toFixed(2));
  revenue = Number(revenue.toFixed(2));
  adRevenue = Number(adRevenue.toFixed(2));
  return {
    leads,
    appointments,
    consultationsHeld,
    casesWon,
    spendEur: spend,
    revenueEur: revenue,
    adRevenueEur: adRevenue,
    // Only the Umsatz the ads brought: Umsatz from posts or Empfehlungen
    // used no Werbebudget and would make the ads look better than they are.
    roas: spend > 0 ? Number((adRevenue / spend).toFixed(2)) : null,
    qualifiedAdLeads,
    // Organic Anfragen use no Werbebudget, so they never lower the cost; an
    // organic start (no Werbebudget) has no cost per Anfrage, not 0 €.
    costPerQualifiedLead: costPerQualified(spend, qualifiedAdLeads),
  };
}

/** No-show share among resolved consultations (held or missed), or null. */
function noShowRateOf(d: { consultationsHeld: number; noShows: number }): number | null {
  const resolved = d.consultationsHeld + d.noShows;
  return resolved > 0 ? d.noShows / resolved : null;
}

// ---------------------------------------------------------------
// Dashboard bundle: one live query for every KPI card
// ---------------------------------------------------------------
//
// The dashboard has up to six windows (Anfragen, Umsatz, Trichter, No-Show,
// each with its comparison window). Instead of one transaction per window
// and card, it reads the sparse per-day rows ONCE, from the earliest day any
// card needs up to today, and slices every card's numbers out of that in JS.
// `cache()` dedupes the read across the Suspense loaders of one render; the
// short `unstable_cache` keeps a range toggle from re-reading for 30 s.

const dashboardLiveDaysCached = cacheClinicQuery(
  "dashboardLiveDays",
  (clinicId: string, userId: string, fromDate: string, toDate: string) =>
    liveKpiDays(
      clinicId,
      userId,
      berlinStartOfDay(fromDate),
      new Date(berlinStartOfDay(addIsoDays(toDate, 1)).getTime() - 1)
    ),
  { revalidate: SHORT_REVALIDATE_S }
);

/** Sparse live rows for Berlin days [fromDate, toDate]; deduped per request. */
export const dashboardLiveDays = cache(
  (clinicId: string, userId: string, fromDate: string, toDate: string) =>
    dashboardLiveDaysCached(clinicId, userId, fromDate, toDate)
);

type DayWindow = { fromDate: string; toDate: string };

function daysIn(days: LiveKpiDay[], win: DayWindow): LiveKpiDay[] {
  return days.filter((d) => d.date >= win.fromDate && d.date <= win.toDate);
}

/** KPI summary of one window, sliced out of `dashboardLiveDays`. */
export function summaryForWindow(days: LiveKpiDay[], win: DayWindow): KpiSummary {
  return summarize(daysIn(days, win));
}

/** Dense per-day series of one window (Berlin date axis, 0 for empty days). */
export function sparklinesForWindow(days: LiveKpiDay[], win: DayWindow): KpiSparklines {
  const byDate = new Map(daysIn(days, win).map((d) => [d.date, d]));
  const out: KpiSparklines = {
    leads: [],
    appointments: [],
    casesWon: [],
    spendEur: [],
    revenueEur: [],
    adRevenueEur: [],
    roas: [],
    noShowRate: [],
    dates: [],
  };
  for (let key = win.fromDate; key <= win.toDate; key = addIsoDays(key, 1)) {
    const r = byDate.get(key);
    out.dates.push(key);
    out.leads.push(r?.leads ?? 0);
    out.appointments.push(r?.appointments ?? 0);
    out.casesWon.push(r?.casesWon ?? 0);
    out.spendEur.push(r?.spendEur ?? 0);
    out.revenueEur.push(r?.revenueEur ?? 0);
    out.adRevenueEur.push(r?.adRevenueEur ?? 0);
    out.roas.push(
      r && r.spendEur > 0 ? Number((r.adRevenueEur / r.spendEur).toFixed(2)) : 0
    );
    out.noShowRate.push(r ? (noShowRateOf(r) ?? 0) : 0);
  }
  return out;
}

/** No-show summary of one window (see `NoShowWindow`). */
export function noShowForWindow(days: LiveKpiDay[], win: DayWindow): NoShowWindow {
  const inWin = daysIn(days, win);
  let resolved = 0;
  let noShows = 0;
  for (const d of inWin) {
    resolved += d.consultationsHeld + d.noShows;
    noShows += d.noShows;
  }
  const spark = sparklinesForWindow(inWin, win);
  return {
    rate: resolved > 0 ? noShows / resolved : null,
    appointments: resolved,
    noShows,
    series: spark.dates.map((date, i) => ({ date, rate: spark.noShowRate[i] ?? 0 })),
  };
}

/**
 * KPI summary over the Berlin calendar days covered by [from, to], computed
 * live from `requests` + `campaign_snapshots`. Pages use the cached export.
 */
export async function kpiSummaryUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<KpiSummary> {
  return summarize(await liveKpiDays(clinicId, userId, from, to));
}

/**
 * Cached for SHORT_REVALIDATE_S. The values are live, so a long TTL would
 * only make them stale (nothing busts the tag while the worker is off).
 */
export const kpiSummary = cacheClinicQuery(
  "kpiSummary",
  kpiSummaryUncached,
  { dateArgs: [0, 1], revalidate: SHORT_REVALIDATE_S }
);

/**
 * Open-queue size ("Neu") at the end of each Berlin day in [from, to], plus
 * the size right before `from` for the comparison line. Same function as
 * `openQueueDailyInRangeWithComparison` in requests.ts (Berlin days, one
 * pass over the Anfragen and their status changes, cached for
 * SHORT_REVALIDATE_S per clinic and window). The old per-(day x Anfrage)
 * correlated subquery here took 10-16 s for a year at 20,000 Anfragen
 * (portal review M-1).
 */
export const openQueueDaily = openQueueDailyInRangeWithComparison;

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
 * Prior covers the same number of Berlin calendar days immediately before
 * `from` (computed in days, so a DST switch inside the window is harmless).
 */
export async function kpiSummaryWithComparisonUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<KpiSummaryWithComparison> {
  const fromDate = berlinDay(from);
  const days =
    Math.round(
      (Date.parse(`${berlinDay(to)}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
        86_400_000
    ) + 1;
  const prior = priorDashboardWindow({ fromDate, days });

  const [current, priorSummary] = await Promise.all([
    kpiSummary(clinicId, userId, from, to),
    kpiSummary(clinicId, userId, prior.from, prior.to),
  ]);
  return { current, prior: priorSummary, delta: buildDelta(current, priorSummary) };
}

export const kpiSummaryWithComparison = cacheClinicQuery(
  "kpiSummaryWithComparison",
  kpiSummaryWithComparisonUncached,
  { dateArgs: [0, 1], revalidate: SHORT_REVALIDATE_S }
);

export interface KpiSparklines {
  leads: number[];
  appointments: number[];
  casesWon: number[];
  spendEur: number[];
  revenueEur: number[];
  /** Umsatz from Anfragen over Meta or Google ads, the Werbeertrag's numerator. */
  adRevenueEur: number[];
  roas: number[];
  noShowRate: number[];
  /** Parallel array of ISO date strings (YYYY-MM-DD), aligned with each metric. */
  dates: string[];
}

export interface NoShowWindow {
  /**
   * No-show share across the window (0..1): missed Termine divided by all
   * Termine with a known outcome (held or missed). null when none resolved.
   * Pooled over the window, so a single low-volume day cannot dominate.
   */
  rate: number | null;
  /** Termine with a known outcome in the window (held + missed). */
  appointments: number;
  /** Missed Termine in the window. */
  noShows: number;
  /**
   * Daily series for the sparkline, ascending by Berlin date. Days without a
   * resolved Termin render as 0.
   */
  series: Array<{ date: string; rate: number }>;
}

/**
 * Superuser-scoped helper for worker jobs (SLA, monthly report) that run
 * outside a user context. Same live aggregation as `kpiSummary`, so the
 * monthly report matches the dashboard even when `kpi_daily` is stale.
 */
export async function kpiSummaryAdmin(
  clinicId: string,
  from: Date,
  to: Date
): Promise<KpiSummary> {
  return summarize(await selectLiveKpiDays(db, clinicId, from, to));
}
