import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  REQUEST_STATUSES,
  type Plan,
  type RequestStatus,
} from "@/lib/constants";
import {
  KPI_THRESHOLDS,
  PLAN_PRICING_EUR,
  clinicHealthTone,
  type ToneKey,
} from "@/server/constants/admin";

/**
 * Cross-clinic admin queries. Bypass RLS by design — admin has god-view.
 * Every helper assumes the caller already passed `requireAdmin()`.
 *
 * Date helpers: kpi_daily uses DATE columns, so we always slice ISO date.
 */

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const startOfDayUtc = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const startOfMonthUtc = (d: Date) => {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const subDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - days);
  return x;
};

// ---------------------------------------------------------------
// Platform-overview KPI strip on /admin
// ---------------------------------------------------------------

export interface MetricDelta {
  value: number;
  tone: ToneKey;
}

export interface PlatformOverviewMetrics {
  activeClinics: number;
  totalClinics: number;
  monthSpend: number;
  monthRevenue: number;
  monthLeads: number;
  monthCasesWon: number;
  avgCpl: number | null;
  avgCpp: number | null;
  avgRoas: number | null;
  /** % delta vs prior period of equal length. */
  deltas: {
    spend: MetricDelta;
    revenue: MetricDelta;
    leads: MetricDelta;
    cpl: MetricDelta;
    roas: MetricDelta;
  };
  /** 30 daily data points, oldest → newest. */
  sparklines: {
    spend: number[];
    revenue: number[];
    leads: number[];
    cpl: number[];
    roas: number[];
  };
}

export async function platformOverviewMetrics(): Promise<PlatformOverviewMetrics> {
  const now = new Date();
  const monthStart = startOfMonthUtc(now);
  const today = startOfDayUtc(now);

  // Sparkline window — 30 days ending today.
  const sparkFrom = subDays(today, 29);

  // Prior period = previous calendar month (full month).
  const priorMonthEnd = new Date(monthStart);
  priorMonthEnd.setUTCDate(0);
  const priorMonthStart = startOfMonthUtc(priorMonthEnd);

  const [
    [clinicCounts],
    [monthAgg],
    [priorAgg],
    sparkRows,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${schema.clinics.archivedAt} is null)::int`,
      })
      .from(schema.clinics),
    aggregateKpiRange(monthStart, today),
    aggregateKpiRange(priorMonthStart, priorMonthEnd),
    db
      .select({
        date: schema.kpiDaily.date,
        spend: sql<number>`coalesce(sum(${schema.kpiDaily.totalSpendEur}), 0)`,
        revenue: sql<number>`coalesce(sum(${schema.kpiDaily.revenueAttributedEur}), 0)`,
        leads: sql<number>`coalesce(sum(${schema.kpiDaily.qualifiedLeads}), 0)`,
      })
      .from(schema.kpiDaily)
      .where(
        and(
          gte(schema.kpiDaily.date, isoDate(sparkFrom)),
          lte(schema.kpiDaily.date, isoDate(today))
        )
      )
      .groupBy(schema.kpiDaily.date)
      .orderBy(asc(schema.kpiDaily.date)),
  ]);

  const sparklines = buildSparklineSeries(sparkRows, sparkFrom, today);

  const monthSpend = Number(monthAgg?.spend ?? 0);
  const monthRevenue = Number(monthAgg?.revenue ?? 0);
  const monthLeads = Number(monthAgg?.leads ?? 0);
  const monthCases = Number(monthAgg?.cases ?? 0);
  const priorSpend = Number(priorAgg?.spend ?? 0);
  const priorRevenue = Number(priorAgg?.revenue ?? 0);
  const priorLeads = Number(priorAgg?.leads ?? 0);

  const avgCpl = monthLeads > 0 ? monthSpend / monthLeads : null;
  const avgCpp = monthCases > 0 ? monthSpend / monthCases : null;
  const avgRoas = monthSpend > 0 ? monthRevenue / monthSpend : null;
  const priorCpl = priorLeads > 0 ? priorSpend / priorLeads : null;
  const priorRoas = priorSpend > 0 ? priorRevenue / priorSpend : null;

  return {
    activeClinics: Number(clinicCounts?.active ?? 0),
    totalClinics: Number(clinicCounts?.total ?? 0),
    monthSpend,
    monthRevenue,
    monthLeads,
    monthCasesWon: monthCases,
    avgCpl,
    avgCpp,
    avgRoas,
    deltas: {
      spend: pctDelta(monthSpend, priorSpend, "neutral"),
      revenue: pctDelta(monthRevenue, priorRevenue, "higher"),
      leads: pctDelta(monthLeads, priorLeads, "higher"),
      cpl: pctDelta(avgCpl ?? 0, priorCpl ?? 0, "lower"),
      roas: pctDelta(avgRoas ?? 0, priorRoas ?? 0, "higher"),
    },
    sparklines,
  };
}

async function aggregateKpiRange(from: Date, to: Date) {
  const rows = await db
    .select({
      spend: sql<number>`coalesce(sum(${schema.kpiDaily.totalSpendEur}), 0)`,
      revenue: sql<number>`coalesce(sum(${schema.kpiDaily.revenueAttributedEur}), 0)`,
      leads: sql<number>`coalesce(sum(${schema.kpiDaily.qualifiedLeads}), 0)`,
      cases: sql<number>`coalesce(sum(${schema.kpiDaily.casesWon}), 0)`,
    })
    .from(schema.kpiDaily)
    .where(
      and(
        gte(schema.kpiDaily.date, isoDate(from)),
        lte(schema.kpiDaily.date, isoDate(to))
      )
    );
  return rows;
}

function buildSparklineSeries(
  rows: { date: string; spend: number; revenue: number; leads: number }[],
  from: Date,
  to: Date
): PlatformOverviewMetrics["sparklines"] {
  const map = new Map<string, { spend: number; revenue: number; leads: number }>();
  for (const r of rows) {
    map.set(r.date, {
      spend: Number(r.spend),
      revenue: Number(r.revenue),
      leads: Number(r.leads),
    });
  }
  const spend: number[] = [];
  const revenue: number[] = [];
  const leads: number[] = [];
  const cpl: number[] = [];
  const roas: number[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const key = isoDate(cursor);
    const r = map.get(key) ?? { spend: 0, revenue: 0, leads: 0 };
    spend.push(r.spend);
    revenue.push(r.revenue);
    leads.push(r.leads);
    cpl.push(r.leads > 0 ? r.spend / r.leads : 0);
    roas.push(r.spend > 0 ? r.revenue / r.spend : 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { spend, revenue, leads, cpl, roas };
}

type DeltaKind = "higher" | "lower" | "neutral";
function pctDelta(current: number, prior: number, kind: DeltaKind): MetricDelta {
  if (!Number.isFinite(prior) || prior === 0) {
    return { value: 0, tone: "neutral" };
  }
  const value = ((current - prior) / Math.abs(prior)) * 100;
  let tone: ToneKey = "neutral";
  if (kind === "higher") {
    tone = value >= 5 ? "good" : value <= -5 ? "bad" : "neutral";
  } else if (kind === "lower") {
    tone = value <= -5 ? "good" : value >= 5 ? "bad" : "neutral";
  }
  return { value: Number(value.toFixed(1)), tone };
}

// ---------------------------------------------------------------
// Pipeline funnel + AI score distribution
// ---------------------------------------------------------------

export interface FunnelBucket {
  status: RequestStatus;
  count: number;
}

export async function pipelineFunnel(periodDays = 30): Promise<FunnelBucket[]> {
  const since = subDays(new Date(), periodDays);
  const rows = await db
    .select({
      status: schema.requests.status,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.requests)
    .where(gte(schema.requests.createdAt, since))
    .groupBy(schema.requests.status);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.status, Number(r.total));
  return REQUEST_STATUSES.map((s) => ({ status: s, count: map.get(s) ?? 0 }));
}

export interface AiCategoryDistribution {
  hot: number;
  warm: number;
  cold: number;
  unscored: number;
}

export async function aiScoreDistribution(
  periodDays = 30
): Promise<AiCategoryDistribution> {
  const since = subDays(new Date(), periodDays);
  const rows = await db
    .select({
      category: schema.requests.aiCategory,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.requests)
    .where(gte(schema.requests.createdAt, since))
    .groupBy(schema.requests.aiCategory);

  const out: AiCategoryDistribution = { hot: 0, warm: 0, cold: 0, unscored: 0 };
  for (const r of rows) {
    const c = (r.category ?? "unscored") as keyof AiCategoryDistribution;
    if (c in out) out[c] = Number(r.total);
    else out.unscored += Number(r.total);
  }
  return out;
}

// ---------------------------------------------------------------
// SLA breach + response-time leaderboards
// ---------------------------------------------------------------

export interface SlaBreachRow {
  clinicId: string;
  clinicName: string;
  breachCount: number;
  oldestBreachHours: number;
}

export async function slaBreachLeaderboard(limit = 5): Promise<SlaBreachRow[]> {
  const rows = await db
    .select({
      clinicId: schema.clinics.id,
      clinicName: schema.clinics.displayName,
      breachCount: sql<number>`count(*)::int`,
      oldestSlaAt: sql<Date>`min(${schema.requests.slaRespondBy})`,
    })
    .from(schema.requests)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(
      and(
        isNull(schema.requests.firstContactedAt),
        sql`${schema.requests.slaRespondBy} < now()`,
        inArray(schema.requests.status, ["neu", "qualifiziert"])
      )
    )
    .groupBy(schema.clinics.id, schema.clinics.displayName)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  const now = Date.now();
  return rows.map((r) => ({
    clinicId: r.clinicId,
    clinicName: r.clinicName,
    breachCount: Number(r.breachCount),
    oldestBreachHours: r.oldestSlaAt
      ? Math.max(0, Math.floor((now - new Date(r.oldestSlaAt).getTime()) / 3_600_000))
      : 0,
  }));
}

export interface ResponseTimeRow {
  clinicId: string;
  clinicName: string;
  medianFirstContactMin: number | null;
  breachRatePct: number;
  totalRequests: number;
}

export async function responseTimeRanking(
  periodDays = 30,
  limit = 10
): Promise<ResponseTimeRow[]> {
  const since = subDays(new Date(), periodDays).toISOString();
  const rows = await db.execute<{
    clinic_id: string;
    clinic_name: string;
    median_min: number | null;
    breach_rate_pct: number | null;
    total: number;
  }>(sql`
    SELECT
      c.id AS clinic_id,
      c.display_name AS clinic_name,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (r.first_contacted_at - r.created_at)) / 60
      ) FILTER (WHERE r.first_contacted_at IS NOT NULL) AS median_min,
      (
        100.0 * count(*) FILTER (
          WHERE r.first_contacted_at IS NULL AND r.sla_respond_by < now()
        ) / NULLIF(count(*), 0)
      ) AS breach_rate_pct,
      count(*)::int AS total
    FROM ${schema.requests} r
    JOIN ${schema.clinics} c ON c.id = r.clinic_id
    WHERE r.created_at >= ${since}::timestamptz
    GROUP BY c.id, c.display_name
    HAVING count(*) > 0
    ORDER BY median_min ASC NULLS LAST
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    medianFirstContactMin:
      r.median_min == null ? null : Math.round(Number(r.median_min)),
    breachRatePct: Number(r.breach_rate_pct ?? 0),
    totalRequests: Number(r.total ?? 0),
  }));
}

// ---------------------------------------------------------------
// Spend / revenue daily series + platform mix
// ---------------------------------------------------------------

export interface SpendRevenuePoint {
  date: string;
  spendEur: number;
  revenueEur: number;
  roas: number | null;
}

export async function spendRevenueSeries(days = 90): Promise<SpendRevenuePoint[]> {
  const today = startOfDayUtc(new Date());
  const from = subDays(today, days - 1);
  const rows = await db
    .select({
      date: schema.kpiDaily.date,
      spend: sql<number>`coalesce(sum(${schema.kpiDaily.totalSpendEur}), 0)`,
      revenue: sql<number>`coalesce(sum(${schema.kpiDaily.revenueAttributedEur}), 0)`,
    })
    .from(schema.kpiDaily)
    .where(
      and(
        gte(schema.kpiDaily.date, isoDate(from)),
        lte(schema.kpiDaily.date, isoDate(today))
      )
    )
    .groupBy(schema.kpiDaily.date)
    .orderBy(asc(schema.kpiDaily.date));

  const map = new Map<string, { spend: number; revenue: number }>();
  for (const r of rows) {
    map.set(r.date, { spend: Number(r.spend), revenue: Number(r.revenue) });
  }
  const out: SpendRevenuePoint[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= today.getTime()) {
    const key = isoDate(cursor);
    const r = map.get(key) ?? { spend: 0, revenue: 0 };
    out.push({
      date: key,
      spendEur: r.spend,
      revenueEur: r.revenue,
      roas: r.spend > 0 ? Number((r.revenue / r.spend).toFixed(2)) : null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export interface PlatformMixRow {
  platform: "meta" | "google" | "csv";
  spendEur: number;
  leads: number;
  sharePct: number;
}

export async function platformMix(periodDays = 30): Promise<PlatformMixRow[]> {
  const today = startOfDayUtc(new Date());
  const from = subDays(today, periodDays - 1);
  const rows = await db
    .select({
      platform: schema.campaignSnapshots.platform,
      spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
      leads: sql<number>`coalesce(sum(${schema.campaignSnapshots.leads}), 0)`,
    })
    .from(schema.campaignSnapshots)
    .where(
      and(
        gte(schema.campaignSnapshots.snapshotDate, isoDate(from)),
        lte(schema.campaignSnapshots.snapshotDate, isoDate(today))
      )
    )
    .groupBy(schema.campaignSnapshots.platform);

  const totalSpend = rows.reduce((acc, r) => acc + Number(r.spend), 0) || 1;
  return rows.map((r) => ({
    platform: r.platform as "meta" | "google" | "csv",
    spendEur: Number(r.spend),
    leads: Number(r.leads),
    sharePct: Number(((Number(r.spend) / totalSpend) * 100).toFixed(1)),
  }));
}

// ---------------------------------------------------------------
// Clinic leaderboard for /admin and /admin/clinics
// ---------------------------------------------------------------

export interface ClinicLeaderboardRow {
  clinicId: string;
  name: string;
  slug: string;
  plan: Plan;
  archivedAt: Date | null;
  mrrEur: number;
  spendEur: number;
  revenueEur: number;
  roas: number | null;
  leads: number;
  casesWon: number;
  noShowRate: number | null;
  cpl: number | null;
  lastActivityAt: Date | null;
  healthTone: ToneKey;
}

export async function clinicLeaderboard(args: {
  periodDays?: number;
  limit?: number;
}): Promise<ClinicLeaderboardRow[]> {
  const days = args.periodDays ?? 30;
  const today = startOfDayUtc(new Date());
  const from = subDays(today, days - 1);

  const rows = await db.execute<{
    clinic_id: string;
    name: string;
    slug: string;
    plan: string;
    archived_at: Date | null;
    spend: string | null;
    revenue: string | null;
    leads: number | null;
    cases_won: number | null;
    no_show_rate: string | null;
    last_login: Date | null;
    last_request: Date | null;
  }>(sql`
    SELECT
      c.id            AS clinic_id,
      c.display_name  AS name,
      c.slug          AS slug,
      c.plan          AS plan,
      c.archived_at   AS archived_at,
      kpi.spend       AS spend,
      kpi.revenue     AS revenue,
      kpi.leads       AS leads,
      kpi.cases_won   AS cases_won,
      kpi.no_show_rate AS no_show_rate,
      activity.last_login AS last_login,
      activity.last_request AS last_request
    FROM ${schema.clinics} c
    LEFT JOIN LATERAL (
      SELECT
        coalesce(sum(total_spend_eur), 0)              AS spend,
        coalesce(sum(revenue_attributed_eur), 0)       AS revenue,
        coalesce(sum(qualified_leads), 0)              AS leads,
        coalesce(sum(cases_won), 0)                    AS cases_won,
        avg(no_show_rate)                              AS no_show_rate
      FROM ${schema.kpiDaily}
      WHERE clinic_id = c.id
        AND date >= ${isoDate(from)}
        AND date <= ${isoDate(today)}
    ) kpi ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        (SELECT max(last_login_at) FROM ${schema.clinicUsers}
          WHERE clinic_id = c.id AND archived_at IS NULL) AS last_login,
        (SELECT max(created_at) FROM ${schema.requests}
          WHERE clinic_id = c.id) AS last_request
    ) activity ON TRUE
    ORDER BY c.display_name ASC
    ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
  `);

  return rows.map((r) => {
    const spend = Number(r.spend ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const leads = Number(r.leads ?? 0);
    const plan = (r.plan === "erweitert" ? "erweitert" : "standard") as Plan;
    const cpl = leads > 0 ? Number((spend / leads).toFixed(2)) : null;
    const roas = spend > 0 ? Number((revenue / spend).toFixed(2)) : null;
    const lastLogin = r.last_login ? new Date(r.last_login) : null;
    const lastRequest = r.last_request ? new Date(r.last_request) : null;
    const lastActivity = pickLatest(lastLogin, lastRequest);
    return {
      clinicId: r.clinic_id,
      name: r.name,
      slug: r.slug,
      plan,
      archivedAt: r.archived_at ? new Date(r.archived_at) : null,
      mrrEur: PLAN_PRICING_EUR[plan],
      spendEur: spend,
      revenueEur: revenue,
      roas,
      leads,
      casesWon: Number(r.cases_won ?? 0),
      noShowRate: r.no_show_rate == null ? null : Number(r.no_show_rate),
      cpl,
      lastActivityAt: lastActivity,
      healthTone: clinicHealthTone({ spend, revenue, cpl }),
    };
  });
}

function pickLatest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

// ---------------------------------------------------------------
// Per-clinic deep performance for clinic detail "Leistung" tab
// ---------------------------------------------------------------

export interface ClinicPerformance {
  summary: {
    spendEur: number;
    revenueEur: number;
    leads: number;
    casesWon: number;
    cpl: number | null;
    cpp: number | null;
    roas: number | null;
    noShowRate: number | null;
  };
  daily: SpendRevenuePoint[];
  bySource: { source: string; leads: number; revenueEur: number }[];
  byPlatform: PlatformMixRow[];
  funnel: FunnelBucket[];
  goals: {
    metric: string;
    targetValue: number;
    currentValue: number;
    periodStart: string;
    periodEnd: string;
  }[];
}

export async function clinicPerformance(
  clinicId: string,
  days = 90
): Promise<ClinicPerformance> {
  const today = startOfDayUtc(new Date());
  const from = subDays(today, days - 1);

  const [
    [summaryRow],
    dailyRows,
    bySourceRows,
    platformRows,
    funnelRows,
    goalRows,
  ] = await Promise.all([
    db
      .select({
        spend: sql<number>`coalesce(sum(${schema.kpiDaily.totalSpendEur}), 0)`,
        revenue: sql<number>`coalesce(sum(${schema.kpiDaily.revenueAttributedEur}), 0)`,
        leads: sql<number>`coalesce(sum(${schema.kpiDaily.qualifiedLeads}), 0)`,
        cases: sql<number>`coalesce(sum(${schema.kpiDaily.casesWon}), 0)`,
        noShow: sql<number>`avg(${schema.kpiDaily.noShowRate})`,
      })
      .from(schema.kpiDaily)
      .where(
        and(
          eq(schema.kpiDaily.clinicId, clinicId),
          gte(schema.kpiDaily.date, isoDate(from)),
          lte(schema.kpiDaily.date, isoDate(today))
        )
      ),
    db
      .select({
        date: schema.kpiDaily.date,
        spend: sql<number>`coalesce(${schema.kpiDaily.totalSpendEur}, 0)`,
        revenue: sql<number>`coalesce(${schema.kpiDaily.revenueAttributedEur}, 0)`,
      })
      .from(schema.kpiDaily)
      .where(
        and(
          eq(schema.kpiDaily.clinicId, clinicId),
          gte(schema.kpiDaily.date, isoDate(from)),
          lte(schema.kpiDaily.date, isoDate(today))
        )
      )
      .orderBy(asc(schema.kpiDaily.date)),
    db
      .select({
        source: schema.requests.source,
        leads: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}), 0)`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from)
        )
      )
      .groupBy(schema.requests.source),
    db
      .select({
        platform: schema.campaignSnapshots.platform,
        spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
        leads: sql<number>`coalesce(sum(${schema.campaignSnapshots.leads}), 0)`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, isoDate(from)),
          lte(schema.campaignSnapshots.snapshotDate, isoDate(today))
        )
      )
      .groupBy(schema.campaignSnapshots.platform),
    db
      .select({
        status: schema.requests.status,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from)
        )
      )
      .groupBy(schema.requests.status),
    db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.clinicId, clinicId))
      .orderBy(desc(schema.goals.createdAt)),
  ]);

  const spend = Number(summaryRow?.spend ?? 0);
  const revenue = Number(summaryRow?.revenue ?? 0);
  const leads = Number(summaryRow?.leads ?? 0);
  const cases = Number(summaryRow?.cases ?? 0);
  const noShow = summaryRow?.noShow == null ? null : Number(summaryRow.noShow);

  // Build daily series with zero-fill.
  const dailyMap = new Map<string, { spend: number; revenue: number }>();
  for (const r of dailyRows) {
    dailyMap.set(r.date, { spend: Number(r.spend), revenue: Number(r.revenue) });
  }
  const daily: SpendRevenuePoint[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= today.getTime()) {
    const key = isoDate(cursor);
    const r = dailyMap.get(key) ?? { spend: 0, revenue: 0 };
    daily.push({
      date: key,
      spendEur: r.spend,
      revenueEur: r.revenue,
      roas: r.spend > 0 ? Number((r.revenue / r.spend).toFixed(2)) : null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const totalPlatformSpend = platformRows.reduce(
    (a, r) => a + Number(r.spend),
    0
  ) || 1;

  const funnelMap = new Map<string, number>();
  for (const r of funnelRows) funnelMap.set(r.status, Number(r.total));

  const todayIso = isoDate(today);
  const activeGoals = goalRows.filter(
    (g) => g.periodStart <= todayIso && g.periodEnd >= todayIso
  );

  const goals = await Promise.all(
    activeGoals.map(async (g) => ({
      metric: g.metric,
      targetValue: Number(g.targetValue),
      currentValue: await goalCurrentValue(clinicId, g.metric, g.periodStart, g.periodEnd),
      periodStart: g.periodStart,
      periodEnd: g.periodEnd,
    }))
  );

  return {
    summary: {
      spendEur: spend,
      revenueEur: revenue,
      leads,
      casesWon: cases,
      cpl: leads > 0 ? Number((spend / leads).toFixed(2)) : null,
      cpp: cases > 0 ? Number((spend / cases).toFixed(2)) : null,
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
      noShowRate: noShow,
    },
    daily,
    bySource: bySourceRows.map((r) => ({
      source: r.source,
      leads: Number(r.leads),
      revenueEur: Number(r.revenue),
    })),
    byPlatform: platformRows.map((r) => ({
      platform: r.platform as "meta" | "google" | "csv",
      spendEur: Number(r.spend),
      leads: Number(r.leads),
      sharePct: Number(((Number(r.spend) / totalPlatformSpend) * 100).toFixed(1)),
    })),
    funnel: REQUEST_STATUSES.map((s) => ({
      status: s,
      count: funnelMap.get(s) ?? 0,
    })),
    goals,
  };
}

async function goalCurrentValue(
  clinicId: string,
  metric: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const column = (() => {
    switch (metric) {
      case "qualified_leads":
        return schema.kpiDaily.qualifiedLeads;
      case "cases_won":
        return schema.kpiDaily.casesWon;
      case "appointments":
        return schema.kpiDaily.appointments;
      case "revenue":
        return schema.kpiDaily.revenueAttributedEur;
      default:
        return null;
    }
  })();
  if (!column) return 0;
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${column}), 0)` })
    .from(schema.kpiDaily)
    .where(
      and(
        eq(schema.kpiDaily.clinicId, clinicId),
        gte(schema.kpiDaily.date, periodStart),
        lte(schema.kpiDaily.date, periodEnd)
      )
    );
  return Number(rows[0]?.total ?? 0);
}

// ---------------------------------------------------------------
// Cross-clinic lead browser (/admin/leads + clinic Leads tab)
// ---------------------------------------------------------------

export interface AdminLeadFilters {
  clinicIds?: string[];
  status?: RequestStatus[];
  source?: string[];
  aiCategory?: ("hot" | "warm" | "cold" | "unscored")[];
  fromDate?: Date | null;
  toDate?: Date | null;
  slaBreachedOnly?: boolean;
  search?: string;
}

export interface AdminLeadRow {
  id: string;
  clinicId: string;
  clinicName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  treatmentWish: string | null;
  source: string;
  status: RequestStatus;
  aiScore: number | null;
  aiCategory: string | null;
  slaRespondBy: Date | null;
  firstContactedAt: Date | null;
  createdAt: Date;
  convertedRevenueEur: number | null;
}

export async function globalLeads(
  filters: AdminLeadFilters = {},
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: AdminLeadRow[]; total: number; aggregates: {
  total: number;
  qualified: number;
  won: number;
  revenueEur: number;
} }> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const where = buildLeadWhere(filters);

  const [items, [{ total }], [aggRow]] = await Promise.all([
    db
      .select({
        id: schema.requests.id,
        clinicId: schema.requests.clinicId,
        clinicName: schema.clinics.displayName,
        contactName: schema.requests.contactName,
        contactEmail: schema.requests.contactEmail,
        contactPhone: schema.requests.contactPhone,
        treatmentWish: schema.requests.treatmentWish,
        source: schema.requests.source,
        status: schema.requests.status,
        aiScore: schema.requests.aiScore,
        aiCategory: schema.requests.aiCategory,
        slaRespondBy: schema.requests.slaRespondBy,
        firstContactedAt: schema.requests.firstContactedAt,
        createdAt: schema.requests.createdAt,
        convertedRevenueEur: schema.requests.convertedRevenueEur,
      })
      .from(schema.requests)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
      .where(where)
      .orderBy(desc(schema.requests.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.requests)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where ${schema.requests.status} in ('qualifiziert','termin_vereinbart','beratung_erschienen','gewonnen'))::int`,
        won: sql<number>`count(*) filter (where ${schema.requests.status} = 'gewonnen')::int`,
        revenue: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}), 0)`,
      })
      .from(schema.requests)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
      .where(where),
  ]);

  return {
    items: items.map((i) => ({
      ...i,
      status: i.status as RequestStatus,
      convertedRevenueEur:
        i.convertedRevenueEur == null ? null : Number(i.convertedRevenueEur),
    })),
    total: Number(total ?? 0),
    aggregates: {
      total: Number(aggRow?.total ?? 0),
      qualified: Number(aggRow?.qualified ?? 0),
      won: Number(aggRow?.won ?? 0),
      revenueEur: Number(aggRow?.revenue ?? 0),
    },
  };
}

function buildLeadWhere(filters: AdminLeadFilters): SQL | undefined {
  const predicates: SQL[] = [];
  if (filters.clinicIds?.length) {
    predicates.push(inArray(schema.requests.clinicId, filters.clinicIds));
  }
  if (filters.status?.length) {
    predicates.push(inArray(schema.requests.status, filters.status));
  }
  if (filters.source?.length) {
    predicates.push(inArray(schema.requests.source, filters.source));
  }
  if (filters.aiCategory?.length) {
    const realCats = filters.aiCategory.filter((c) => c !== "unscored");
    const wantsUnscored = filters.aiCategory.includes("unscored");
    const parts: SQL[] = [];
    if (realCats.length) parts.push(inArray(schema.requests.aiCategory, realCats));
    if (wantsUnscored) parts.push(isNull(schema.requests.aiCategory));
    if (parts.length) {
      predicates.push(parts.length === 1 ? parts[0]! : or(...parts)!);
    }
  }
  if (filters.fromDate) {
    predicates.push(gte(schema.requests.createdAt, filters.fromDate));
  }
  if (filters.toDate) {
    predicates.push(lte(schema.requests.createdAt, filters.toDate));
  }
  if (filters.slaBreachedOnly) {
    predicates.push(
      and(
        isNull(schema.requests.firstContactedAt),
        sql`${schema.requests.slaRespondBy} < now()`
      )!
    );
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    predicates.push(
      or(
        ilike(schema.requests.contactName, term),
        ilike(schema.requests.contactEmail, term),
        ilike(schema.requests.contactPhone, term),
        ilike(schema.requests.treatmentWish, term)
      )!
    );
  }
  return predicates.length ? and(...predicates) : undefined;
}

// ---------------------------------------------------------------
// Clinic activity (login + audit + uploads)
// ---------------------------------------------------------------

export interface ClinicActivity {
  logins: { userId: string; email: string; lastLoginAt: Date | null; mfaEnrolled: boolean }[];
  audit: {
    id: string;
    createdAt: Date;
    actorEmail: string | null;
    action: string;
    entityKind: string | null;
    entityId: string | null;
  }[];
  documentUploads: { id: string; title: string; kind: string; createdAt: Date }[];
  assetUploads: { id: string; title: string; kind: string; createdAt: Date }[];
  animationRequests: {
    id: string;
    title: string | null;
    status: string;
    requestedAt: Date | null;
    deliveredAt: Date | null;
  }[];
}

export async function clinicActivity(
  clinicId: string,
  days = 30
): Promise<ClinicActivity> {
  const since = subDays(new Date(), days);

  const [logins, audit, documents, assets, animations] = await Promise.all([
    db
      .select({
        userId: schema.clinicUsers.id,
        email: schema.clinicUsers.email,
        lastLoginAt: schema.clinicUsers.lastLoginAt,
        mfaEnrolled: schema.clinicUsers.mfaEnrolled,
      })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, clinicId),
          isNull(schema.clinicUsers.archivedAt)
        )
      )
      .orderBy(desc(schema.clinicUsers.lastLoginAt)),
    db
      .select({
        id: schema.auditLog.id,
        createdAt: schema.auditLog.createdAt,
        actorEmail: schema.auditLog.actorEmail,
        action: schema.auditLog.action,
        entityKind: schema.auditLog.entityKind,
        entityId: schema.auditLog.entityId,
      })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.clinicId, clinicId),
          gte(schema.auditLog.createdAt, since)
        )
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(50),
    db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        kind: schema.documents.kind,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.clinicId, clinicId),
          gte(schema.documents.createdAt, since)
        )
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(20),
    db
      .select({
        id: schema.assets.id,
        title: schema.assets.title,
        kind: schema.assets.kind,
        createdAt: schema.assets.createdAt,
      })
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.clinicId, clinicId),
          gte(schema.assets.createdAt, since)
        )
      )
      .orderBy(desc(schema.assets.createdAt))
      .limit(20),
    db
      .select({
        id: schema.animationInstances.id,
        title: schema.animationLibrary.title,
        status: schema.animationInstances.status,
        requestedAt: schema.animationInstances.requestedAt,
        deliveredAt: schema.animationInstances.deliveredAt,
      })
      .from(schema.animationInstances)
      .leftJoin(
        schema.animationLibrary,
        eq(schema.animationLibrary.id, schema.animationInstances.libraryId)
      )
      .where(
        and(
          eq(schema.animationInstances.clinicId, clinicId),
          ne(schema.animationInstances.status, "standard")
        )
      )
      .orderBy(desc(schema.animationInstances.requestedAt))
      .limit(20),
  ]);

  return { logins, audit, documentUploads: documents, assetUploads: assets, animationRequests: animations };
}

// ---------------------------------------------------------------
// Operations queues
// ---------------------------------------------------------------

export interface PendingOperations {
  slaBreaches: number;
  openUpgrades: number;
  animationsRequested: number;
  animationsInProduction: number;
  syncErrors: number;
  mfaMissing: number;
  stalledRequests: number;
}

export async function pendingOperationCounts(): Promise<PendingOperations> {
  const stalledThreshold = subDays(new Date(), 7);

  const [
    [sla],
    [up],
    [anReq],
    [anProd],
    [sync],
    [mfa],
    [stalled],
  ] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.requests)
      .where(
        and(
          isNull(schema.requests.firstContactedAt),
          sql`${schema.requests.slaRespondBy} < now()`,
          inArray(schema.requests.status, ["neu", "qualifiziert"])
        )
      ),
    db
      .select({ total: count() })
      .from(schema.upgradeRequests)
      .where(eq(schema.upgradeRequests.status, "offen")),
    db
      .select({ total: count() })
      .from(schema.animationInstances)
      .where(eq(schema.animationInstances.status, "requested")),
    db
      .select({ total: count() })
      .from(schema.animationInstances)
      .where(eq(schema.animationInstances.status, "in_production")),
    db
      .select({ total: count() })
      .from(schema.platformCredentials)
      .where(isNotNull(schema.platformCredentials.lastSyncError)),
    db
      .select({ total: count() })
      .from(schema.clinicUsers)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
      .where(
        and(
          eq(schema.clinicUsers.mfaEnrolled, false),
          isNull(schema.clinicUsers.archivedAt),
          isNull(schema.clinics.archivedAt),
          isNotNull(schema.clinicUsers.lastLoginAt)
        )
      ),
    db
      .select({ total: count() })
      .from(schema.requests)
      .where(
        and(
          inArray(schema.requests.status, [
            "neu",
            "qualifiziert",
            "termin_vereinbart",
            "beratung_erschienen",
          ]),
          lte(schema.requests.createdAt, stalledThreshold)
        )
      ),
  ]);

  return {
    slaBreaches: Number(sla?.total ?? 0),
    openUpgrades: Number(up?.total ?? 0),
    animationsRequested: Number(anReq?.total ?? 0),
    animationsInProduction: Number(anProd?.total ?? 0),
    syncErrors: Number(sync?.total ?? 0),
    mfaMissing: Number(mfa?.total ?? 0),
    stalledRequests: Number(stalled?.total ?? 0),
  };
}

export interface SlaQueueRow {
  id: string;
  clinicId: string;
  clinicName: string;
  contactName: string | null;
  contactEmail: string | null;
  status: RequestStatus;
  source: string;
  slaRespondBy: Date | null;
  createdAt: Date;
  ageHours: number;
}

export async function slaBreachQueue(limit = 30): Promise<SlaQueueRow[]> {
  const rows = await db
    .select({
      id: schema.requests.id,
      clinicId: schema.requests.clinicId,
      clinicName: schema.clinics.displayName,
      contactName: schema.requests.contactName,
      contactEmail: schema.requests.contactEmail,
      status: schema.requests.status,
      source: schema.requests.source,
      slaRespondBy: schema.requests.slaRespondBy,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(
      and(
        isNull(schema.requests.firstContactedAt),
        sql`${schema.requests.slaRespondBy} < now()`,
        inArray(schema.requests.status, ["neu", "qualifiziert"])
      )
    )
    .orderBy(asc(schema.requests.slaRespondBy))
    .limit(limit);

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    status: r.status as RequestStatus,
    ageHours: Math.max(
      0,
      Math.floor((now - new Date(r.createdAt).getTime()) / 3_600_000)
    ),
  }));
}

export interface SyncErrorRow {
  clinicId: string;
  clinicName: string;
  platform: "meta" | "google";
  accountId: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string;
}

export async function syncErrorList(): Promise<SyncErrorRow[]> {
  const rows = await db
    .select({
      clinicId: schema.platformCredentials.clinicId,
      clinicName: schema.clinics.displayName,
      platform: schema.platformCredentials.platform,
      accountId: schema.platformCredentials.accountId,
      lastSyncedAt: schema.platformCredentials.lastSyncedAt,
      lastSyncError: schema.platformCredentials.lastSyncError,
    })
    .from(schema.platformCredentials)
    .innerJoin(
      schema.clinics,
      eq(schema.clinics.id, schema.platformCredentials.clinicId)
    )
    .where(isNotNull(schema.platformCredentials.lastSyncError))
    .orderBy(desc(schema.platformCredentials.lastSyncedAt));

  return rows.map((r) => ({
    ...r,
    platform: r.platform as "meta" | "google",
    lastSyncError: r.lastSyncError ?? "Unbekannter Fehler",
  }));
}

export interface MfaMissingRow {
  userId: string;
  email: string;
  fullName: string | null;
  clinicId: string;
  clinicName: string;
  role: string;
  lastLoginAt: Date | null;
}

export async function inactiveTeamMembers(): Promise<MfaMissingRow[]> {
  const rows = await db
    .select({
      userId: schema.clinicUsers.id,
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
      clinicId: schema.clinicUsers.clinicId,
      clinicName: schema.clinics.displayName,
      role: schema.clinicUsers.role,
      lastLoginAt: schema.clinicUsers.lastLoginAt,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(
      and(
        eq(schema.clinicUsers.mfaEnrolled, false),
        isNull(schema.clinicUsers.archivedAt),
        isNull(schema.clinics.archivedAt),
        isNotNull(schema.clinicUsers.lastLoginAt)
      )
    )
    .orderBy(desc(schema.clinicUsers.lastLoginAt))
    .limit(50);
  return rows;
}

export interface StalledLeadRow {
  id: string;
  clinicId: string;
  clinicName: string;
  contactName: string | null;
  status: RequestStatus;
  source: string;
  createdAt: Date;
  ageDays: number;
}

export async function stalledLeads(limit = 30): Promise<StalledLeadRow[]> {
  const since = subDays(new Date(), 7);
  const rows = await db
    .select({
      id: schema.requests.id,
      clinicId: schema.requests.clinicId,
      clinicName: schema.clinics.displayName,
      contactName: schema.requests.contactName,
      status: schema.requests.status,
      source: schema.requests.source,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(
      and(
        inArray(schema.requests.status, [
          "neu",
          "qualifiziert",
          "termin_vereinbart",
          "beratung_erschienen",
        ]),
        lte(schema.requests.createdAt, since)
      )
    )
    .orderBy(asc(schema.requests.createdAt))
    .limit(limit);

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    status: r.status as RequestStatus,
    ageDays: Math.max(
      0,
      Math.floor((now - new Date(r.createdAt).getTime()) / 86_400_000)
    ),
  }));
}

// ---------------------------------------------------------------
// Audit telemetry — overview tab
// ---------------------------------------------------------------

export interface AuditOverview {
  totalEvents: number;
  uniqueActors: number;
  topAction: { action: string; count: number } | null;
  volumeTrend: { date: string; count: number }[];
  heatmap: {
    clinicNames: string[];
    actions: string[];
    matrix: number[][];
  };
  topActors: { actorEmail: string; count: number }[];
}

export async function auditOverview(periodDays = 30): Promise<AuditOverview> {
  const today = startOfDayUtc(new Date());
  const from = subDays(today, periodDays - 1);

  const [
    [totals],
    actionRows,
    trendRows,
    actorRows,
    cellRows,
  ] = await Promise.all([
    db
      .select({
        totalEvents: sql<number>`count(*)::int`,
        uniqueActors: sql<number>`count(distinct ${schema.auditLog.actorEmail})::int`,
      })
      .from(schema.auditLog)
      .where(gte(schema.auditLog.createdAt, from)),
    db
      .select({
        action: schema.auditLog.action,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.auditLog)
      .where(gte(schema.auditLog.createdAt, from))
      .groupBy(schema.auditLog.action)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
    db.execute<{ date: string; count: number }>(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
             count(*)::int AS count
      FROM ${schema.auditLog}
      WHERE created_at >= ${from.toISOString()}::timestamptz
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at) ASC
    `),
    db
      .select({
        actorEmail: schema.auditLog.actorEmail,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.auditLog)
      .where(
        and(
          gte(schema.auditLog.createdAt, from),
          isNotNull(schema.auditLog.actorEmail)
        )
      )
      .groupBy(schema.auditLog.actorEmail)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
    db.execute<{
      clinic_name: string;
      action: string;
      total: number;
    }>(sql`
      SELECT
        c.display_name AS clinic_name,
        a.action       AS action,
        count(*)::int  AS total
      FROM ${schema.auditLog} a
      JOIN ${schema.clinics} c ON c.id = a.clinic_id
      WHERE a.created_at >= ${from.toISOString()}::timestamptz
      GROUP BY c.display_name, a.action
    `),
  ]);

  // Build heatmap matrix
  const actions = actionRows.map((a) => a.action);
  const clinicTotals = new Map<string, number>();
  for (const r of cellRows) {
    clinicTotals.set(
      r.clinic_name,
      (clinicTotals.get(r.clinic_name) ?? 0) + Number(r.total)
    );
  }
  const clinicNames = [...clinicTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([n]) => n);

  const matrix = clinicNames.map((cn) =>
    actions.map((act) => {
      const cell = cellRows.find(
        (r) => r.clinic_name === cn && r.action === act
      );
      return cell ? Number(cell.total) : 0;
    })
  );

  // Trend zero-fill
  const trendMap = new Map<string, number>();
  for (const r of trendRows) trendMap.set(r.date, Number(r.count));
  const trend: AuditOverview["volumeTrend"] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= today.getTime()) {
    const key = isoDate(cursor);
    trend.push({ date: key, count: trendMap.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    totalEvents: Number(totals?.totalEvents ?? 0),
    uniqueActors: Number(totals?.uniqueActors ?? 0),
    topAction: actionRows[0]
      ? { action: actionRows[0].action, count: Number(actionRows[0].total) }
      : null,
    volumeTrend: trend,
    heatmap: { clinicNames, actions, matrix },
    topActors: actorRows.map((r) => ({
      actorEmail: r.actorEmail ?? "—",
      count: Number(r.total),
    })),
  };
}

// ---------------------------------------------------------------
// Cross-clinic top campaigns for /admin/leistung
// ---------------------------------------------------------------

export interface CampaignAggregateRow {
  clinicId: string;
  clinicName: string;
  source: string;
  campaignId: string | null;
  leads: number;
  revenueEur: number;
  spendEur: number;
  cpl: number | null;
  roas: number | null;
}

export async function topCampaigns(args: {
  periodDays?: number;
  limit?: number;
  ascending?: boolean;
}): Promise<CampaignAggregateRow[]> {
  const days = args.periodDays ?? 30;
  const since = subDays(new Date(), days);

  // Pull lead-side aggregates first; campaign spend joined per clinic.
  const leadRows = await db
    .select({
      clinicId: schema.requests.clinicId,
      clinicName: schema.clinics.displayName,
      source: schema.requests.source,
      campaignId: schema.requests.sourceCampaignId,
      leads: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}), 0)`,
    })
    .from(schema.requests)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(gte(schema.requests.createdAt, since))
    .groupBy(
      schema.requests.clinicId,
      schema.clinics.displayName,
      schema.requests.source,
      schema.requests.sourceCampaignId
    );

  // Spend aggregated per (clinic, platform). Map source → platform.
  const spendRows = await db
    .select({
      clinicId: schema.campaignSnapshots.clinicId,
      platform: schema.campaignSnapshots.platform,
      spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
    })
    .from(schema.campaignSnapshots)
    .where(gte(schema.campaignSnapshots.snapshotDate, isoDate(since)))
    .groupBy(schema.campaignSnapshots.clinicId, schema.campaignSnapshots.platform);

  const spendMap = new Map<string, number>();
  for (const r of spendRows) {
    spendMap.set(`${r.clinicId}::${r.platform}`, Number(r.spend));
  }

  const rows: CampaignAggregateRow[] = leadRows.map((l) => {
    const platform =
      l.source === "meta" || l.source === "google" ? l.source : "csv";
    const spend = spendMap.get(`${l.clinicId}::${platform}`) ?? 0;
    const leads = Number(l.leads);
    const revenue = Number(l.revenue);
    return {
      clinicId: l.clinicId,
      clinicName: l.clinicName,
      source: l.source,
      campaignId: l.campaignId,
      leads,
      revenueEur: revenue,
      spendEur: spend,
      cpl: leads > 0 && spend > 0 ? Number((spend / leads).toFixed(2)) : null,
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
    };
  });

  rows.sort((a, b) => {
    const ra = a.roas ?? -Infinity;
    const rb = b.roas ?? -Infinity;
    return args.ascending ? ra - rb : rb - ra;
  });

  return rows.slice(0, args.limit ?? 10);
}

// ---------------------------------------------------------------
// Re-export tone helper for callers
// ---------------------------------------------------------------
export { KPI_THRESHOLDS, PLAN_PRICING_EUR };
