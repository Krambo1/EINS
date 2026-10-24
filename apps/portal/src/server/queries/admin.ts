import "server-only";
import { cache } from "react";
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
import { channelGroupBy, channelKeys, channelOfGroup, type ChannelGroup } from "./_channel";
import { firstAttemptAtSql, toAttemptDate } from "./response-time";
import {
  REQUEST_STATUSES,
  type RequestStatus,
} from "@/lib/constants";
import { berlinDateString, type CurrencyCode } from "@/lib/formatting";
import {
  KPI_THRESHOLDS,
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

const subDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - days);
  return x;
};

/** Berlin calendar helpers on ISO `YYYY-MM-DD` strings. Day boundaries for
 *  everything a human reads as "heute / dieser Monat" are Berlin, not UTC. */
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoAddDays = (iso: string, days: number) => {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
};
const berlinToday = () => berlinDateString(new Date());

/**
 * The demo Praxis (seed slug `_template`, "Praxis Dr. Demo" in prod) carries
 * seeded requests and spam for sales demos. It never counts in cross-clinic
 * numbers, and neither do archived clinics (G-13).
 */
export const DEMO_CLINIC_SLUG = "_template";

/** Ids of the demo Praxis (normally one; empty when it does not exist). */
export const demoClinicIds = cache(async (): Promise<Set<string>> => {
  const rows = await db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(eq(schema.clinics.slug, DEMO_CLINIC_SLUG));
  return new Set(rows.map((r) => r.id));
});

/** Predicate on the `clinics` table: active, non-demo Praxis. */
const realClinicWhere = () =>
  and(isNull(schema.clinics.archivedAt), ne(schema.clinics.slug, DEMO_CLINIC_SLUG))!;

/** Same predicate for raw SQL with the clinics table aliased as `c`. */
const REAL_CLINIC_SQL = sql.raw(
  `(c.archived_at IS NULL AND c.slug <> '${DEMO_CLINIC_SLUG}')`
);

/**
 * Live replacement for `kpi_daily` (G-06): kpi_daily is only written by the
 * nightly pg-boss worker, which is off in production, so every admin number
 * built on it read 0 while the Praxis had requests. This derived table
 * computes the same per-(clinic, Berlin day) figures on the fly with the
 * worker's own definitions (processors/kpi-rebuild.ts): spend from
 * campaign_snapshots; leads = non-spam requests, cases = 'gewonnen', revenue
 * = converted revenue of won requests, all bucketed by the request's Berlin
 * creation day. `scope` filters the clinics table aliased as `c`.
 */
function liveKpiDaily(fromIso: string, toIso: string, scope: SQL): SQL {
  return sql`(
    SELECT u.clinic_id, u.day,
      sum(u.spend)::float8        AS spend,
      sum(u.revenue)::float8      AS revenue,
      sum(u.leads)::int           AS leads,
      sum(u.cases)::int           AS cases,
      sum(u.no_shows)::int        AS no_shows,
      sum(u.held)::int            AS held,
      sum(u.appointments)::int    AS appointments
    FROM (
      SELECT cs.clinic_id, to_char(cs.snapshot_date, 'YYYY-MM-DD') AS day,
        coalesce(cs.spend_eur, 0)::numeric AS spend, 0::numeric AS revenue,
        0 AS leads, 0 AS cases, 0 AS no_shows, 0 AS held, 0 AS appointments
      FROM campaign_snapshots cs
      JOIN clinics c ON c.id = cs.clinic_id
      WHERE cs.snapshot_date >= ${fromIso}::date
        AND cs.snapshot_date <= ${toIso}::date
        AND ${scope}
      UNION ALL
      SELECT r.clinic_id,
        to_char((r.created_at AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD'),
        0::numeric,
        (CASE WHEN r.status = 'gewonnen' THEN coalesce(r.converted_revenue_eur, 0) ELSE 0 END)::numeric,
        (r.status <> 'spam')::int,
        (r.status = 'gewonnen')::int,
        (r.status = 'no_show')::int,
        (r.status IN ('beratung_erschienen','behandelt','gewonnen'))::int,
        (r.status IN ('termin_vereinbart','beratung_erschienen','behandelt','gewonnen'))::int
      FROM requests r
      JOIN clinics c ON c.id = r.clinic_id
      WHERE r.created_at >= (${fromIso}::date::timestamp AT TIME ZONE 'Europe/Berlin')
        AND r.created_at < ((${toIso}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
        AND ${scope}
    ) u
    GROUP BY u.clinic_id, u.day
  )`;
}

interface LiveDayRow {
  day: string;
  spend: number;
  revenue: number;
  leads: number;
  cases: number;
  no_shows: number;
  held: number;
  appointments: number;
}

/** Live per-day totals across all clinics in `scope`, oldest first. */
async function liveDailyTotals(fromIso: string, toIso: string, scope: SQL): Promise<LiveDayRow[]> {
  const rows = (await db.execute(sql`
    SELECT lk.day,
      coalesce(sum(lk.spend), 0)::float8 AS spend,
      coalesce(sum(lk.revenue), 0)::float8 AS revenue,
      coalesce(sum(lk.leads), 0)::int AS leads,
      coalesce(sum(lk.cases), 0)::int AS cases,
      coalesce(sum(lk.no_shows), 0)::int AS no_shows,
      coalesce(sum(lk.held), 0)::int AS held,
      coalesce(sum(lk.appointments), 0)::int AS appointments
    FROM ${liveKpiDaily(fromIso, toIso, scope)} lk
    GROUP BY lk.day
    ORDER BY lk.day
  `)) as unknown as LiveDayRow[];
  return rows.map((r) => ({
    day: r.day,
    spend: Number(r.spend),
    revenue: Number(r.revenue),
    leads: Number(r.leads),
    cases: Number(r.cases),
    no_shows: Number(r.no_shows),
    held: Number(r.held),
    appointments: Number(r.appointments),
  }));
}

function sumDays(rows: LiveDayRow[], fromIso: string, toIso: string) {
  const out = { spend: 0, revenue: 0, leads: 0, cases: 0, noShows: 0, held: 0, appointments: 0 };
  for (const r of rows) {
    if (r.day < fromIso || r.day > toIso) continue;
    out.spend += r.spend;
    out.revenue += r.revenue;
    out.leads += r.leads;
    out.cases += r.cases;
    out.noShows += r.no_shows;
    out.held += r.held;
    out.appointments += r.appointments;
  }
  return out;
}

// ---------------------------------------------------------------
// Platform-overview KPI strip on /admin
// ---------------------------------------------------------------

export interface MetricDelta {
  value: number;
  tone: ToneKey;
  /**
   * When true the delta is not meaningful (the current period has no data at
   * all) and should render as a neutral "–" rather than a computed figure.
   * Prevents an empty window from showing a misleading "-100 %" on every
   * metric. See `pctDelta`.
   */
  suppressed?: boolean;
}

export interface PlatformOverviewMetrics {
  activeClinics: number;
  totalClinics: number;
  monthSpend: number;
  monthRevenue: number;
  /** Distinct billing currencies across the clinics whose revenue feeds the
   *  cross-clinic sums here. One entry → a uniform total formattable in that
   *  currency; two (EUR + CHF) → the sum mixes currencies and must be
   *  suppressed (formatClinicAggregate). Spend always stays EUR. */
  revenueCurrencies: CurrencyCode[];
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
    /** ISO `YYYY-MM-DD` dates aligned with each value array. */
    dates: string[];
    spend: number[];
    revenue: number[];
    leads: number[];
    cpl: number[];
    roas: number[];
  };
}

export async function platformOverviewMetrics(): Promise<PlatformOverviewMetrics> {
  // Berlin calendar month (G-07). The comparison window is the SAME number of
  // days at the start of the prior month (7 days vs 7 days on the 7th), not
  // the full prior month, so the tiles do not read -75 % every morning.
  const todayIso = berlinToday();
  const monthStartIso = `${todayIso.slice(0, 8)}01`;
  const dayOfMonth = Number(todayIso.slice(8, 10));
  const priorMonthEndIso = isoAddDays(monthStartIso, -1);
  const priorMonthStartIso = `${priorMonthEndIso.slice(0, 8)}01`;
  const priorCompareEndIso = [isoAddDays(priorMonthStartIso, dayOfMonth - 1), priorMonthEndIso].sort()[0]!;

  // Sparkline window: 30 Berlin days ending today.
  const sparkFromIso = isoAddDays(todayIso, -29);
  const fromIso = [sparkFromIso, priorMonthStartIso].sort()[0]!;

  const [[clinicCounts], currencyRows, dayRows] = await Promise.all([
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${schema.clinics.archivedAt} is null)::int`,
      })
      .from(schema.clinics)
      .where(ne(schema.clinics.slug, DEMO_CLINIC_SLUG)),
    // Distinct billing currencies across the real clinics contributing to the
    // sums. One entry renders normally; EUR + CHF flags the total as mixed.
    db
      .selectDistinct({ currency: schema.clinics.currency })
      .from(schema.clinics)
      .where(realClinicWhere()),
    liveDailyTotals(fromIso, todayIso, REAL_CLINIC_SQL),
  ]);

  const sparklines = buildSparklineSeries(
    dayRows.map((r) => ({ date: r.day, spend: r.spend, revenue: r.revenue, leads: r.leads })),
    isoToDate(sparkFromIso),
    isoToDate(todayIso)
  );

  const month = sumDays(dayRows, monthStartIso, todayIso);
  const prior = sumDays(dayRows, priorMonthStartIso, priorCompareEndIso);
  const monthSpend = month.spend;
  const monthRevenue = month.revenue;
  const monthLeads = month.leads;
  const monthCases = month.cases;
  const priorSpend = prior.spend;
  const priorRevenue = prior.revenue;
  const priorLeads = prior.leads;

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
    revenueCurrencies: currencyRows.map((r) => r.currency as CurrencyCode),
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
  const dates: string[] = [];
  const spend: number[] = [];
  const revenue: number[] = [];
  const leads: number[] = [];
  const cpl: number[] = [];
  const roas: number[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const key = isoDate(cursor);
    const r = map.get(key) ?? { spend: 0, revenue: 0, leads: 0 };
    dates.push(key);
    spend.push(r.spend);
    revenue.push(r.revenue);
    leads.push(r.leads);
    cpl.push(r.leads > 0 ? r.spend / r.leads : 0);
    roas.push(r.spend > 0 ? r.revenue / r.spend : 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { dates, spend, revenue, leads, cpl, roas };
}

type DeltaKind = "higher" | "lower" | "neutral";
function pctDelta(current: number, prior: number, kind: DeltaKind): MetricDelta {
  // No comparison base (first month, or nothing in the prior window): a
  // percentage is meaningless, render "–" instead of "0 % vs. Vormonat".
  if (!Number.isFinite(prior) || prior === 0) {
    return { value: 0, tone: "neutral", suppressed: true };
  }
  // Current period is empty (e.g. a stale seed window, or before the first
  // sync of the month). The arithmetic would yield exactly -100 % on every
  // metric, which reads as a catastrophic decline rather than "no data yet".
  // Show a neutral "–" instead. Genuine declines (current > 0) are untouched.
  if (current === 0) {
    return { value: 0, tone: "neutral", suppressed: true };
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
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(and(gte(schema.requests.createdAt, since), realClinicWhere()))
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
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
    .where(
      and(
        gte(schema.requests.createdAt, since),
        ne(schema.requests.status, "spam"),
        realClinicWhere()
      )
    )
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
        eq(schema.requests.status, "neu"),
        realClinicWhere()
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
      AND r.status <> 'spam'
      AND ${REAL_CLINIC_SQL}
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
  const todayIso = berlinToday();
  const fromIso = isoAddDays(todayIso, -(days - 1));
  const rows = await liveDailyTotals(fromIso, todayIso, REAL_CLINIC_SQL);
  return zeroFillDaily(rows, fromIso, todayIso);
}

/** Daily spend/revenue series with one point per Berlin day, zero-filled. */
function zeroFillDaily(rows: LiveDayRow[], fromIso: string, toIso: string): SpendRevenuePoint[] {
  const map = new Map(rows.map((r) => [r.day, r] as const));
  const out: SpendRevenuePoint[] = [];
  for (let key = fromIso; key <= toIso; key = isoAddDays(key, 1)) {
    const r = map.get(key);
    const spend = r?.spend ?? 0;
    const revenue = r?.revenue ?? 0;
    out.push({
      date: key,
      spendEur: spend,
      revenueEur: revenue,
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,
    });
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
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.campaignSnapshots.clinicId))
    .where(
      and(
        gte(schema.campaignSnapshots.snapshotDate, isoDate(from)),
        lte(schema.campaignSnapshots.snapshotDate, isoDate(today)),
        realClinicWhere()
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
  archivedAt: Date | null;
  /** This Praxis's billing currency. Row-level revenue formats with it; the
   *  cross-clinic totals built from these rows use formatClinicAggregate. */
  currency: CurrencyCode;
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
  /** Only active, non-demo clinics (dashboard). /admin/clinics lists all. */
  realOnly?: boolean;
}): Promise<ClinicLeaderboardRow[]> {
  const days = args.periodDays ?? 30;
  const todayIso = berlinToday();
  const fromIso = isoAddDays(todayIso, -(days - 1));
  const scope = args.realOnly ? REAL_CLINIC_SQL : sql`TRUE`;

  const rows = await db.execute<{
    clinic_id: string;
    name: string;
    slug: string;
    archived_at: Date | null;
    currency: string | null;
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
      c.archived_at   AS archived_at,
      c.currency      AS currency,
      kpi.spend       AS spend,
      kpi.revenue     AS revenue,
      kpi.leads       AS leads,
      kpi.cases_won   AS cases_won,
      kpi.no_show_rate AS no_show_rate,
      activity.last_login AS last_login,
      activity.last_request AS last_request
    FROM ${schema.clinics} c
    LEFT JOIN (
      -- Live from requests + campaign_snapshots (G-06), not kpi_daily.
      SELECT
        lk.clinic_id,
        coalesce(sum(lk.spend), 0)        AS spend,
        coalesce(sum(lk.revenue), 0)      AS revenue,
        coalesce(sum(lk.leads), 0)::int   AS leads,
        coalesce(sum(lk.cases), 0)::int   AS cases_won,
        CASE WHEN sum(lk.no_shows) + sum(lk.held) > 0
          THEN sum(lk.no_shows)::float8 / (sum(lk.no_shows) + sum(lk.held))
        END                               AS no_show_rate
      FROM ${liveKpiDaily(fromIso, todayIso, scope)} lk
      GROUP BY lk.clinic_id
    ) kpi ON kpi.clinic_id = c.id
    LEFT JOIN LATERAL (
      SELECT
        (SELECT max(last_login_at) FROM ${schema.clinicUsers}
          WHERE clinic_id = c.id AND archived_at IS NULL) AS last_login,
        (SELECT max(created_at) FROM ${schema.requests}
          WHERE clinic_id = c.id) AS last_request
    ) activity ON TRUE
    WHERE ${scope}
    ORDER BY c.display_name ASC
    ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
  `);

  return rows.map((r) => {
    const spend = Number(r.spend ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const leads = Number(r.leads ?? 0);
    const cpl = leads > 0 ? Number((spend / leads).toFixed(2)) : null;
    const roas = spend > 0 ? Number((revenue / spend).toFixed(2)) : null;
    const lastLogin = r.last_login ? new Date(r.last_login) : null;
    const lastRequest = r.last_request ? new Date(r.last_request) : null;
    const lastActivity = pickLatest(lastLogin, lastRequest);
    return {
      clinicId: r.clinic_id,
      name: r.name,
      slug: r.slug,
      archivedAt: r.archived_at ? new Date(r.archived_at) : null,
      currency: (r.currency ?? "EUR") as CurrencyCode,
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
  /** Billing currency of this Praxis (clinics.currency). Formats this clinic's
   *  own attributed revenue (revenueEur / per-source / revenue goals); agency
   *  spend, CPL, CPP stay EUR. */
  currency: CurrencyCode;
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

/** Sum per-(source, UTM) groups into reporting-channel rows, largest first. */
function foldByChannel(
  rows: Array<ChannelGroup & { leads: number; revenue: number }>
): { source: string; leads: number; revenueEur: number }[] {
  const out = new Map<string, { source: string; leads: number; revenueEur: number }>();
  for (const r of rows) {
    const channel = channelOfGroup(r);
    const row = out.get(channel) ?? { source: channel, leads: 0, revenueEur: 0 };
    row.leads += Number(r.leads);
    row.revenueEur += Number(r.revenue);
    out.set(channel, row);
  }
  return Array.from(out.values()).sort((a, b) => b.leads - a.leads);
}

export async function clinicPerformance(
  clinicId: string,
  days = 90
): Promise<ClinicPerformance> {
  const today = startOfDayUtc(new Date());
  const from = subDays(today, days - 1);
  const todayIso = berlinToday();
  const fromIso = isoAddDays(todayIso, -(days - 1));
  const clinicScope = sql`c.id = ${clinicId}`;

  const [
    [clinicRow],
    dailyRows,
    bySourceRows,
    platformRows,
    funnelRows,
    goalRows,
  ] = await Promise.all([
    db
      .select({ currency: schema.clinics.currency })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1),
    // Live (G-06): kpi_daily is only built by the worker, which is off.
    liveDailyTotals(fromIso, todayIso, clinicScope),
    // Grouped by reporting channel (entry point + UTM) so organic and paid
    // Meta stay apart; folded in channelOfGroup below.
    db
      .select({
        ...channelKeys,
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
      .groupBy(...channelGroupBy),
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

  const totals = sumDays(dailyRows, fromIso, todayIso);
  const spend = totals.spend;
  const revenue = totals.revenue;
  const leads = totals.leads;
  const cases = totals.cases;
  // No-show share among resolved consultations (same rule as kpi-rebuild).
  const noShow =
    totals.noShows + totals.held > 0 ? totals.noShows / (totals.noShows + totals.held) : null;

  const daily = zeroFillDaily(dailyRows, fromIso, todayIso);

  const totalPlatformSpend = platformRows.reduce(
    (a, r) => a + Number(r.spend),
    0
  ) || 1;

  const funnelMap = new Map<string, number>();
  for (const r of funnelRows) funnelMap.set(r.status, Number(r.total));

  const activeGoals = goalRows.filter(
    (g) => g.periodStart <= todayIso && g.periodEnd >= todayIso
  );

  // One live query for all active goals (D-23), summed per goal period.
  const goalDays =
    activeGoals.length > 0
      ? await liveDailyTotals(
          activeGoals.map((g) => g.periodStart).sort()[0]!,
          activeGoals.map((g) => g.periodEnd).sort().reverse()[0]!,
          clinicScope
        )
      : [];
  const goals = activeGoals.map((g) => ({
    metric: g.metric,
    targetValue: Number(g.targetValue),
    currentValue: goalCurrentValue(goalDays, g.metric, g.periodStart, g.periodEnd),
    periodStart: g.periodStart,
    periodEnd: g.periodEnd,
  }));

  return {
    currency: (clinicRow?.currency ?? "EUR") as CurrencyCode,
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
    bySource: foldByChannel(bySourceRows),
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

function goalCurrentValue(
  days: LiveDayRow[],
  metric: string,
  periodStart: string,
  periodEnd: string
): number {
  const t = sumDays(days, periodStart, periodEnd);
  switch (metric) {
    case "leads":
      return t.leads;
    case "cases_won":
      return t.cases;
    case "appointments":
      return t.appointments;
    case "revenue":
      return t.revenue;
    default:
      return 0;
  }
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
  /** Billing currency of THIS row's Praxis. Cross-clinic table, so each row
   *  formats its own revenue with its own currency. */
  currency: CurrencyCode;
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
  /** First contact attempt per the 48-Werkstunden rule (queries/response-time.ts). */
  firstAttemptAt: Date | null;
  createdAt: Date;
  convertedRevenueEur: number | null;
}

export async function globalLeads(
  filters: AdminLeadFilters = {},
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: AdminLeadRow[]; total: number; aggregates: {
  total: number;
  inFunnel: number;
  won: number;
  revenueEur: number;
  /** Distinct billing currencies across the filtered set. One entry → the
   *  revenue total is formattable in it; EUR + CHF → mixed, suppress the sum. */
  currencies: CurrencyCode[];
} }> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const where = buildLeadWhere(filters);

  const [items, [aggRow]] = await Promise.all([
    db
      .select({
        id: schema.requests.id,
        clinicId: schema.requests.clinicId,
        clinicName: schema.clinics.displayName,
        currency: schema.clinics.currency,
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
        firstAttemptAt: firstAttemptAtSql(),
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
      .select({
        total: sql<number>`count(*)::int`,
        inFunnel: sql<number>`count(*) filter (where ${schema.requests.status} in ('termin_vereinbart','beratung_erschienen','behandelt','gewonnen'))::int`,
        won: sql<number>`count(*) filter (where ${schema.requests.status} = 'gewonnen')::int`,
        revenue: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}), 0)`,
        currencies: sql<string[] | null>`array_agg(distinct ${schema.clinics.currency})`,
      })
      .from(schema.requests)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
      .where(where),
  ]);

  return {
    items: items.map((i) => ({
      ...i,
      status: i.status as RequestStatus,
      currency: i.currency as CurrencyCode,
      firstAttemptAt: toAttemptDate(i.firstAttemptAt),
      convertedRevenueEur:
        i.convertedRevenueEur == null ? null : Number(i.convertedRevenueEur),
    })),
    total: Number(aggRow?.total ?? 0),
    aggregates: {
      total: Number(aggRow?.total ?? 0),
      inFunnel: Number(aggRow?.inFunnel ?? 0),
      won: Number(aggRow?.won ?? 0),
      revenueEur: Number(aggRow?.revenue ?? 0),
      currencies: (aggRow?.currencies ?? []).map((c) => c as CurrencyCode),
    },
  };
}

function buildLeadWhere(filters: AdminLeadFilters): SQL | undefined {
  const predicates: SQL[] = [];
  if (filters.clinicIds?.length) {
    predicates.push(inArray(schema.requests.clinicId, filters.clinicIds));
  } else {
    // Cross-clinic inbox: no demo Praxis, no archived Praxis (G-13). A
    // picked clinic (filter or clinic detail tab) is shown as it is.
    predicates.push(realClinicWhere());
  }
  if (filters.status?.length) {
    predicates.push(inArray(schema.requests.status, filters.status));
  } else {
    // Spam stays hidden unless explicitly filtered for.
    predicates.push(ne(schema.requests.status, "spam"));
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
    const term = `%${escapeLike(filters.search)}%`;
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

/** Escape LIKE wildcards so a search for "50%" matches literally (G-23). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------
// Clinic activity (login + audit + uploads)
// ---------------------------------------------------------------

export interface ClinicActivity {
  logins: { userId: string; email: string; lastLoginAt: Date | null }[];
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
  animationsRequested: number;
  animationsInProduction: number;
  syncErrors: number;
  stalledRequests: number;
}

/**
 * Wrapped in React `cache` (D-16): the admin layout (nav badge) and the home
 * page both call it in the same render; one set of queries serves both.
 */
export const pendingOperationCounts = cache(pendingOperationCountsImpl);

async function pendingOperationCountsImpl(): Promise<PendingOperations> {
  const stalledThreshold = subDays(new Date(), 7);

  const [
    [sla],
    [anReq],
    [anProd],
    [sync],
    [stalled],
  ] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.requests)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
      .where(
        and(
          isNull(schema.requests.firstContactedAt),
          sql`${schema.requests.slaRespondBy} < now()`,
          eq(schema.requests.status, "neu"),
          realClinicWhere()
        )
      ),
    db
      .select({ total: count() })
      .from(schema.animationInstances)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.animationInstances.clinicId))
      .where(and(eq(schema.animationInstances.status, "requested"), realClinicWhere())),
    db
      .select({ total: count() })
      .from(schema.animationInstances)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.animationInstances.clinicId))
      .where(and(eq(schema.animationInstances.status, "in_production"), realClinicWhere())),
    db
      .select({ total: count() })
      .from(schema.platformCredentials)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.platformCredentials.clinicId))
      .where(and(isNotNull(schema.platformCredentials.lastSyncError), realClinicWhere())),
    db
      .select({ total: count() })
      .from(schema.requests)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
      .where(
        and(
          inArray(schema.requests.status, [
            "neu",
            "termin_vereinbart",
            "beratung_erschienen",
          ]),
          lte(schema.requests.createdAt, stalledThreshold),
          realClinicWhere()
        )
      ),
  ]);

  return {
    slaBreaches: Number(sla?.total ?? 0),
    animationsRequested: Number(anReq?.total ?? 0),
    animationsInProduction: Number(anProd?.total ?? 0),
    syncErrors: Number(sync?.total ?? 0),
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
        eq(schema.requests.status, "neu"),
        realClinicWhere()
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
    .where(and(isNotNull(schema.platformCredentials.lastSyncError), realClinicWhere()))
    .orderBy(desc(schema.platformCredentials.lastSyncedAt));

  return rows.map((r) => ({
    ...r,
    platform: r.platform as "meta" | "google",
    lastSyncError: r.lastSyncError ?? "Unbekannter Fehler",
  }));
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
          "termin_vereinbart",
          "beratung_erschienen",
        ]),
        lte(schema.requests.createdAt, since),
        realClinicWhere()
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
      actorEmail: r.actorEmail ?? "–",
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
  /** Billing currency of this row's Praxis; row-level revenue formats with it. */
  currency: CurrencyCode;
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
      currency: schema.clinics.currency,
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
      schema.clinics.currency,
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
      currency: (l.currency ?? "EUR") as CurrencyCode,
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
// Cross-clinic user directory (/admin/users)
// Generalizes the per-clinic Team tab: clinic_users ⋈ clinics.
// ---------------------------------------------------------------

export type AdminUserStatus = "active" | "invited" | "archived";

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  status: AdminUserStatus;
  lastLoginAt: Date | null;
  invitedAt: Date | null;
  createdAt: Date;
  clinicId: string;
  clinicName: string;
}

export interface AdminUserFilters {
  role?: string;
  status?: AdminUserStatus;
  search?: string;
  /** Only users who have never logged in (last_login_at IS NULL). */
  neverLoggedIn?: boolean;
}

function userStatus(u: {
  archivedAt: Date | null;
  invitedAt: Date | null;
  lastLoginAt: Date | null;
}): AdminUserStatus {
  if (u.archivedAt) return "archived";
  if (u.invitedAt && !u.lastLoginAt) return "invited";
  return "active";
}

export async function adminAllUsers(
  filters: AdminUserFilters = {}
): Promise<AdminUserRow[]> {
  const predicates: SQL[] = [];
  if (filters.role) predicates.push(eq(schema.clinicUsers.role, filters.role));
  if (filters.neverLoggedIn) {
    predicates.push(isNull(schema.clinicUsers.lastLoginAt));
  }
  if (filters.search) {
    const term = `%${escapeLike(filters.search)}%`;
    predicates.push(
      or(
        ilike(schema.clinicUsers.email, term),
        ilike(schema.clinicUsers.fullName, term),
        ilike(schema.clinics.displayName, term)
      )!
    );
  }
  const where = predicates.length ? and(...predicates) : undefined;

  const rows = await db
    .select({
      id: schema.clinicUsers.id,
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
      role: schema.clinicUsers.role,
      lastLoginAt: schema.clinicUsers.lastLoginAt,
      invitedAt: schema.clinicUsers.invitedAt,
      archivedAt: schema.clinicUsers.archivedAt,
      createdAt: schema.clinicUsers.createdAt,
      clinicId: schema.clinicUsers.clinicId,
      clinicName: schema.clinics.displayName,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(where)
    .orderBy(asc(schema.clinics.displayName), asc(schema.clinicUsers.email));

  const mapped: AdminUserRow[] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: userStatus(u),
    lastLoginAt: u.lastLoginAt,
    invitedAt: u.invitedAt,
    createdAt: u.createdAt,
    clinicId: u.clinicId,
    clinicName: u.clinicName,
  }));

  // Status is derived, so filter it after mapping.
  return filters.status
    ? mapped.filter((u) => u.status === filters.status)
    : mapped;
}

// ---------------------------------------------------------------
// Integration health (/admin/integrations)
// Generalizes the per-clinic Integrationen tab: platform_credentials ⋈ clinics.
// ---------------------------------------------------------------

export interface AdminIntegrationRow {
  clinicId: string;
  clinicName: string;
  provider: string;
  accountId: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  tokenExpiresAt: Date | null;
  tone: ToneKey;
}

const STALE_SYNC_MS = 48 * 3_600_000;
const TOKEN_SOON_MS = 7 * 86_400_000;

export async function adminIntegrationHealth(): Promise<AdminIntegrationRow[]> {
  const rows = await db
    .select({
      clinicId: schema.platformCredentials.clinicId,
      clinicName: schema.clinics.displayName,
      provider: schema.platformCredentials.platform,
      accountId: schema.platformCredentials.accountId,
      lastSyncedAt: schema.platformCredentials.lastSyncedAt,
      lastSyncError: schema.platformCredentials.lastSyncError,
      tokenExpiresAt: schema.platformCredentials.expiresAt,
    })
    .from(schema.platformCredentials)
    .innerJoin(
      schema.clinics,
      eq(schema.clinics.id, schema.platformCredentials.clinicId)
    )
    // G-14: the intake row is the Zielseiten secret, not a synced platform
    // (never has lastSyncedAt); its health is the Messwege table below.
    .where(and(ne(schema.platformCredentials.platform, "intake"), isNull(schema.clinics.archivedAt)))
    .orderBy(asc(schema.clinics.displayName), asc(schema.platformCredentials.platform));

  const now = Date.now();
  const out = rows.map((r) => {
    const expMs = r.tokenExpiresAt ? new Date(r.tokenExpiresAt).getTime() : null;
    const syncMs = r.lastSyncedAt ? new Date(r.lastSyncedAt).getTime() : null;
    let tone: ToneKey = "good";
    if (r.lastSyncError || (expMs != null && expMs < now)) {
      tone = "bad";
    } else if (
      (expMs != null && expMs < now + TOKEN_SOON_MS) ||
      syncMs == null ||
      now - syncMs > STALE_SYNC_MS
    ) {
      tone = "warn";
    }
    return { ...r, tone };
  });

  // Worst first so the operator sees problems at the top.
  const order: Record<ToneKey, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

// ---------------------------------------------------------------
// Onboarding pipeline (/admin/onboarding)
// Per-clinic: signup → integration → first request → training → active.
// ---------------------------------------------------------------

export type OnboardingStage =
  | "registriert"
  | "integration_verbunden"
  | "erste_anfrage"
  | "schulung_bestanden"
  | "aktiv";

export interface AdminOnboardingRow {
  clinicId: string;
  clinicName: string;
  slug: string;
  createdAt: Date;
  hasIntegration: boolean;
  hasFirstRequest: boolean;
  quizPassed: boolean;
  latestQuizScore: number | null;
  latestQuizTotal: number | null;
  timelineCount: number;
  lastActivityAt: Date | null;
  stage: OnboardingStage;
  daysSinceSignup: number;
  /** No activity for STUCK_DAYS and not yet "aktiv". */
  stuck: boolean;
}

/** Days without activity (post-signup) before a clinic counts as "stuck". */
const STUCK_DAYS = 14;

function deriveOnboardingStage(r: {
  hasIntegration: boolean;
  hasFirstRequest: boolean;
  quizPassed: boolean;
  recentlyActive: boolean;
}): OnboardingStage {
  if (r.hasIntegration && r.hasFirstRequest && r.quizPassed && r.recentlyActive) {
    return "aktiv";
  }
  if (r.quizPassed) return "schulung_bestanden";
  if (r.hasFirstRequest) return "erste_anfrage";
  if (r.hasIntegration) return "integration_verbunden";
  return "registriert";
}

export async function adminOnboardingStatus(): Promise<AdminOnboardingRow[]> {
  const [
    clinicRows,
    credRows,
    requestRows,
    timelineRows,
    loginRows,
    quizRows,
  ] = await Promise.all([
    db
      .select({
        id: schema.clinics.id,
        name: schema.clinics.displayName,
        slug: schema.clinics.slug,
        createdAt: schema.clinics.createdAt,
      })
      .from(schema.clinics)
      .where(isNull(schema.clinics.archivedAt))
      .orderBy(desc(schema.clinics.createdAt)),
    db
      .select({
        clinicId: schema.platformCredentials.clinicId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.platformCredentials)
      .where(ne(schema.platformCredentials.platform, "intake"))
      .groupBy(schema.platformCredentials.clinicId),
    db
      .select({
        clinicId: schema.requests.clinicId,
        total: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${schema.requests.createdAt})`,
      })
      .from(schema.requests)
      .groupBy(schema.requests.clinicId),
    db
      .select({
        clinicId: schema.clinicTimelineEntries.clinicId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.clinicTimelineEntries)
      .groupBy(schema.clinicTimelineEntries.clinicId),
    db
      .select({
        clinicId: schema.clinicUsers.clinicId,
        lastLogin: sql<Date>`max(${schema.clinicUsers.lastLoginAt})`,
      })
      .from(schema.clinicUsers)
      .where(isNull(schema.clinicUsers.archivedAt))
      .groupBy(schema.clinicUsers.clinicId),
    db.execute<{
      clinic_id: string;
      passed: boolean;
      score: number;
      total: number;
    }>(sql`
      SELECT DISTINCT ON (clinic_id)
        clinic_id, passed, score, total
      FROM ${schema.leitfadenQuizAttempts}
      ORDER BY clinic_id, created_at DESC
    `),
  ]);

  const credSet = new Set(credRows.map((r) => r.clinicId));
  const reqMap = new Map<string, { total: number; lastAt: Date | null }>();
  for (const r of requestRows) {
    reqMap.set(r.clinicId, {
      total: Number(r.total),
      lastAt: r.lastAt ? new Date(r.lastAt) : null,
    });
  }
  const timelineMap = new Map<string, number>();
  for (const r of timelineRows) timelineMap.set(r.clinicId, Number(r.total));
  const loginMap = new Map<string, Date | null>();
  for (const r of loginRows) {
    loginMap.set(r.clinicId, r.lastLogin ? new Date(r.lastLogin) : null);
  }
  const quizMap = new Map<string, { passed: boolean; score: number; total: number }>();
  for (const r of quizRows) {
    quizMap.set(r.clinic_id, {
      passed: r.passed,
      score: Number(r.score),
      total: Number(r.total),
    });
  }

  const now = Date.now();
  return clinicRows.map((c) => {
    const req = reqMap.get(c.id);
    const quiz = quizMap.get(c.id);
    const lastLogin = loginMap.get(c.id) ?? null;
    const lastActivityAt = pickLatest(req?.lastAt ?? null, lastLogin);
    const hasIntegration = credSet.has(c.id);
    const hasFirstRequest = (req?.total ?? 0) > 0;
    const quizPassed = quiz?.passed ?? false;
    const recentlyActive =
      lastActivityAt != null && now - lastActivityAt.getTime() < 30 * 86_400_000;
    const stage = deriveOnboardingStage({
      hasIntegration,
      hasFirstRequest,
      quizPassed,
      recentlyActive,
    });
    const daysSinceSignup = Math.max(
      0,
      Math.floor((now - new Date(c.createdAt).getTime()) / 86_400_000)
    );
    const idleMs = lastActivityAt
      ? now - lastActivityAt.getTime()
      : now - new Date(c.createdAt).getTime();
    const stuck = stage !== "aktiv" && idleMs > STUCK_DAYS * 86_400_000;

    return {
      clinicId: c.id,
      clinicName: c.name,
      slug: c.slug,
      createdAt: new Date(c.createdAt),
      hasIntegration,
      hasFirstRequest,
      quizPassed,
      latestQuizScore: quiz ? quiz.score : null,
      latestQuizTotal: quiz ? quiz.total : null,
      timelineCount: timelineMap.get(c.id) ?? 0,
      lastActivityAt,
      stage,
      daysSinceSignup,
      stuck,
    };
  });
}

// ---------------------------------------------------------------
// Re-export tone helper for callers
// ---------------------------------------------------------------
export { KPI_THRESHOLDS };

// ---------------------------------------------------------------
// What needs Karam today (G-12): nav badges on Garantie-Uhr and Rückruf-Lage
// plus the "Heute wichtig" card on the home page. Cached per render; each
// part fails soft so the admin chrome never breaks on one bad query.
// ---------------------------------------------------------------

export interface AdminAttention {
  /** Clinics with something to do on the Garantie-Uhr (badge). */
  garantie: number;
  garantieCandidates: number;
  garantieEndingSoon: number;
  /** K-9: active, non-demo Praxen without a signing date (no clock runs). */
  garantieWithoutSignedOn: number;
  invoicesUnsent: number;
  unnotifiedDelays: number;
  /** Clinics where a Rückruf step (Warnung, Pause, Fortsetzung) is possible. */
  rueckruf: number;
  /** Non-spam requests in real clinics since yesterday 00:00 Berlin. */
  newRequestsSinceYesterday: number;
}

export const adminAttentionCounts = cache(adminAttentionCountsImpl);

async function adminAttentionCountsImpl(): Promise<AdminAttention> {
  const { listGuaranteeOverview } = await import("@/server/guarantee-clock");
  const { listRueckrufLage } = await import("@/server/response-enforcement");
  const soft = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[admin-attention] ${label} failed:`, err);
      return fallback;
    }
  };

  const [guaranteeAll, rueckrufAll, demoIds, unsentRows, [fresh]] = await Promise.all([
    soft("garantie", () => listGuaranteeOverview(), []),
    soft("rueckruf", () => listRueckrufLage(), []),
    soft("demo", () => demoClinicIds(), new Set<string>()),
    soft(
      "invoice",
      async () =>
        (await db.execute(sql`
          SELECT clinic_id FROM guarantee_clocks
          WHERE qualifying_inquiry_on IS NOT NULL AND first_invoice_sent_on IS NULL
        `)) as unknown as Array<{ clinic_id: string }>,
      [] as Array<{ clinic_id: string }>
    ),
    soft(
      "requests",
      () =>
        db
          .select({ total: count() })
          .from(schema.requests)
          .innerJoin(schema.clinics, eq(schema.clinics.id, schema.requests.clinicId))
          .where(
            and(
              ne(schema.requests.status, "spam"),
              sql`${schema.requests.createdAt} >= ((date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') - interval '1 day') AT TIME ZONE 'Europe/Berlin')`,
              realClinicWhere()
            )
          ),
      [{ total: 0 }]
    ),
  ]);

  // The demo Praxis never counts here: badges, "Heute wichtig" and the admin
  // cards all read these numbers and must name the same Praxen.
  const guarantee = guaranteeAll.filter((g) => !demoIds.has(g.clinicId) && g.clinicSlug !== DEMO_CLINIC_SLUG);
  const rueckruf = rueckrufAll.filter((r) => !demoIds.has(r.clinicId));
  const unsent = new Set(unsentRows.map((r) => r.clinic_id));
  const flagged = new Set<string>();
  let candidates = 0;
  let endingSoon = 0;
  let unnotified = 0;
  let withoutSignedOn = 0;
  for (const g of guarantee) {
    // K-9: listGuaranteeOverview already skips archived clinics.
    if (g.state.status === "ohne_startdatum") {
      withoutSignedOn++;
      flagged.add(g.clinicId);
    }
    const running = g.state.status === "laeuft";
    if (running && g.hasCandidate) {
      candidates++;
      flagged.add(g.clinicId);
    }
    if (running && g.state.daysLeft <= 14) {
      endingSoon++;
      flagged.add(g.clinicId);
    }
    if (g.unnotifiedDelayCount > 0) {
      unnotified++;
      flagged.add(g.clinicId);
    }
    if (g.state.status === "rechnung_faellig" && unsent.has(g.clinicId)) flagged.add(g.clinicId);
  }
  const invoicesUnsent = guarantee.filter(
    (g) => g.state.status === "rechnung_faellig" && unsent.has(g.clinicId)
  ).length;

  return {
    garantie: flagged.size,
    garantieCandidates: candidates,
    garantieEndingSoon: endingSoon,
    invoicesUnsent,
    unnotifiedDelays: unnotified,
    garantieWithoutSignedOn: withoutSignedOn,
    rueckruf: rueckruf.filter((r) => r.state.canWarn || r.state.canPause || r.state.resumeDue).length,
    newRequestsSinceYesterday: Number(fresh?.total ?? 0),
  };
}

// ---------------------------------------------------------------
// Messwege (H-13): per real clinic, when did each EINS-Messweg last bring an
// Anfrage. A Zielseite whose form breaks silently shows up here as "seit X
// Tagen still" while the 90 days keep running.
// ---------------------------------------------------------------

export interface MesswegHealthRow {
  clinicId: string;
  clinicName: string;
  /** Zielseiten-Secret exists (setup-intake ran for this Praxis). */
  zielseiteConnected: boolean;
  lastFormular: Date | null;
  lastAnruf: Date | null;
  lastBuchung: Date | null;
  /** Any non-spam request, any source. */
  lastAny: Date | null;
  tone: ToneKey;
  note: string;
}

/** Days without a Formular-Anfrage before a connected Zielseite is flagged. */
export const MESSWEG_QUIET_DAYS = 14;

export async function adminMesswegHealth(): Promise<MesswegHealthRow[]> {
  const { classifyAttribution } = await import("@/lib/sources");
  const [clinics, intake, bySource] = await Promise.all([
    db
      .select({ id: schema.clinics.id, name: schema.clinics.displayName })
      .from(schema.clinics)
      .where(realClinicWhere())
      .orderBy(asc(schema.clinics.displayName)),
    db
      .select({ clinicId: schema.platformCredentials.clinicId })
      .from(schema.platformCredentials)
      .where(eq(schema.platformCredentials.platform, "intake")),
    db
      .select({
        clinicId: schema.requests.clinicId,
        source: schema.requests.source,
        lastAt: sql<Date>`max(${schema.requests.createdAt})`,
      })
      .from(schema.requests)
      .where(ne(schema.requests.status, "spam"))
      .groupBy(schema.requests.clinicId, schema.requests.source),
  ]);

  const intakeSet = new Set(intake.map((r) => r.clinicId));
  type Acc = { formular: Date | null; anruf: Date | null; buchung: Date | null; any: Date | null };
  const acc = new Map<string, Acc>();
  const later = (a: Date | null, b: Date) => (a && a > b ? a : b);
  for (const r of bySource) {
    const at = new Date(r.lastAt);
    const cur = acc.get(r.clinicId) ?? { formular: null, anruf: null, buchung: null, any: null };
    cur.any = later(cur.any, at);
    const m = classifyAttribution({ source: r.source, utm: null }).messweg;
    if (m) cur[m] = later(cur[m], at);
    acc.set(r.clinicId, cur);
  }

  const now = Date.now();
  const quietMs = MESSWEG_QUIET_DAYS * 86_400_000;
  const rows = clinics.map((c): MesswegHealthRow => {
    const a = acc.get(c.id) ?? { formular: null, anruf: null, buchung: null, any: null };
    const connected = intakeSet.has(c.id);
    let tone: ToneKey = "good";
    let note = "Formular liefert Anfragen.";
    if (!connected && !a.formular) {
      tone = "neutral";
      note = "Keine Zielseite angebunden.";
    } else if (!a.formular) {
      tone = "warn";
      note = "Zielseite angebunden, noch keine Formular-Anfrage.";
    } else if (now - a.formular.getTime() > quietMs) {
      tone = "warn";
      const days = Math.floor((now - a.formular.getTime()) / 86_400_000);
      note = `Seit ${days} Tagen keine Formular-Anfrage. Zielseite prüfen.`;
    }
    return {
      clinicId: c.id,
      clinicName: c.name,
      zielseiteConnected: connected,
      lastFormular: a.formular,
      lastAnruf: a.anruf,
      lastBuchung: a.buchung,
      lastAny: a.any,
      tone,
      note,
    };
  });
  const order: Record<ToneKey, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };
  return rows.sort((x, y) => order[x.tone] - order[y.tone]);
}

// ---------------------------------------------------------------
// Failed background jobs (E-10, admin view). Reads pg-boss directly; no
// job payload is shown (it can carry patient data), only queue name, time,
// retries, the Praxis and the error message.
// ---------------------------------------------------------------

export interface FailedJobRow {
  id: string;
  queue: string;
  failedAt: Date | null;
  createdAt: Date;
  retryCount: number;
  clinicId: string | null;
  clinicName: string | null;
  error: string | null;
}

export interface FailedJobs {
  /** False when the pgboss schema does not exist (worker never started). */
  available: boolean;
  rows: FailedJobRow[];
}

export async function failedJobList(days = 14, limit = 100): Promise<FailedJobs> {
  try {
    const [probe] = (await db.execute(
      sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`
    )) as unknown as Array<{ ok: boolean }>;
    if (!probe?.ok) return { available: false, rows: [] };
    const rows = (await db.execute(sql`
      SELECT j.id::text AS id, j.name AS queue, j.completed_on AS failed_at, j.created_on AS created_at,
             j.retry_count AS retry_count,
             c.id AS clinic_id, c.display_name AS clinic_name,
             left(coalesce(j.output->>'message', j.output::text), 300) AS error
      FROM pgboss.job j
      LEFT JOIN clinics c
        ON (j.data->>'clinicId') ~* '^[0-9a-f-]{36}$' AND c.id::text = (j.data->>'clinicId')
      WHERE j.state = 'failed'
        AND coalesce(j.completed_on, j.created_on) > now() - make_interval(days => ${days})
      ORDER BY coalesce(j.completed_on, j.created_on) DESC
      LIMIT ${limit}
    `)) as unknown as Array<{
      id: string;
      queue: string;
      failed_at: Date | null;
      created_at: Date;
      retry_count: number;
      clinic_id: string | null;
      clinic_name: string | null;
      error: string | null;
    }>;
    return {
      available: true,
      rows: rows.map((r) => ({
        id: r.id,
        queue: r.queue,
        failedAt: r.failed_at ? new Date(r.failed_at) : null,
        createdAt: new Date(r.created_at),
        retryCount: Number(r.retry_count),
        clinicId: r.clinic_id,
        clinicName: r.clinic_name,
        error: r.error,
      })),
    };
  } catch (err) {
    console.error("[admin] failedJobList failed:", err);
    return { available: false, rows: [] };
  }
}
