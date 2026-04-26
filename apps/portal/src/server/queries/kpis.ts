import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { withClinicContext, schema, db } from "@/db/client";

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
  qualifiedLeads: number;
  appointments: number;
  consultationsHeld: number;
  casesWon: number;
  spendEur: number;
  revenueEur: number;
  roas: number | null;
  costPerQualifiedLead: number | null;
}

const emptySummary = (): KpiSummary => ({
  qualifiedLeads: 0,
  appointments: 0,
  consultationsHeld: 0,
  casesWon: 0,
  spendEur: 0,
  revenueEur: 0,
  roas: null,
  costPerQualifiedLead: null,
});

/** Return sum of KPI rows in [from, to]. Inclusive bounds. */
export async function kpiSummary(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<KpiSummary> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        qualifiedLeads: sql<number>`coalesce(sum(${schema.kpiDaily.qualifiedLeads}), 0)`,
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
    const ql = Number(r.qualifiedLeads);
    return {
      qualifiedLeads: ql,
      appointments: Number(r.appointments),
      consultationsHeld: Number(r.consultationsHeld),
      casesWon: Number(r.casesWon),
      spendEur: spend,
      revenueEur: revenue,
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
      costPerQualifiedLead: ql > 0 ? Number((spend / ql).toFixed(2)) : null,
    };
  });
}

/**
 * Daily rows for charts. Sorted ascending.
 */
export async function kpiDailySeries(
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
export async function currentGoals(clinicId: string, userId: string) {
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
 * Convenience: "current month so far" summary for the dashboard.
 */
export async function currentMonthSummary(clinicId: string, userId: string) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return kpiSummary(clinicId, userId, from, to);
}

/**
 * Last-N-days summary, used on the Auswertung "Letzte 30 Tage" toggle.
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
  qualifiedLeadsPct: number | null;
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
    qualifiedLeadsPct: pctChange(cur.qualifiedLeads, prior.qualifiedLeads),
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
 * KPI summary AND prior-period summary for delta chips.
 * Period length is matched: prior covers the same number of days immediately
 * before `from`.
 */
export async function kpiSummaryWithComparison(
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

export interface KpiSparklines {
  qualifiedLeads: number[];
  casesWon: number[];
  spendEur: number[];
  revenueEur: number[];
  roas: number[];
  noShowRate: number[];
}

/**
 * Daily series + flat number arrays for fast sparkline rendering.
 * Returns the same row shape as kpiDailySeries plus an `aggregated.sparklines`
 * structure with one number array per metric, dense across the date range
 * (missing days fill with 0).
 */
export async function kpiDailySeriesWithSparkline(
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
    qualifiedLeads: [],
    casesWon: [],
    spendEur: [],
    revenueEur: [],
    roas: [],
    noShowRate: [],
  };

  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const r = byDate.get(key);
    sparklines.qualifiedLeads.push(Number(r?.qualifiedLeads ?? 0));
    sparklines.casesWon.push(Number(r?.casesWon ?? 0));
    sparklines.spendEur.push(Number(r?.totalSpendEur ?? 0));
    sparklines.revenueEur.push(Number(r?.revenueAttributedEur ?? 0));
    sparklines.roas.push(Number(r?.roas ?? 0));
    sparklines.noShowRate.push(Number(r?.noShowRate ?? 0));
    cursor.setDate(cursor.getDate() + 1);
  }

  return { rows, sparklines };
}

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
      qualifiedLeads: sql<number>`coalesce(sum(${schema.kpiDaily.qualifiedLeads}), 0)`,
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
  const ql = Number(r.qualifiedLeads);
  return {
    qualifiedLeads: ql,
    appointments: Number(r.appointments),
    consultationsHeld: Number(r.consultationsHeld),
    casesWon: Number(r.casesWon),
    spendEur: spend,
    revenueEur: revenue,
    roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
    costPerQualifiedLead: ql > 0 ? Number((spend / ql).toFixed(2)) : null,
  };
}
