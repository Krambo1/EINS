import "server-only";
import { and, eq, gte, lte, sql, isNotNull } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { cacheClinicQuery } from "./_cache";

/**
 * Lifecycle helpers: response time, AI score distribution, weekday/hour
 * heatmaps, cohort retention, and per-staff performance. Used by Detail-mode
 * panels on the Auswertung and Dashboard pages.
 */

export interface ResponseTimeStats {
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  /** Fraction of answered leads where first_contacted - created > SLA. */
  slaBreachRate: number | null;
  totalAnswered: number;
  totalUnanswered: number;
}

const SLA_BREACH_MINUTES = 60 * 24; // 24h is the default SLA we measure against.

async function responseTimeStatsUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<ResponseTimeStats> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [stats] = await tx
      .select({
        avgMinutes: sql<number | null>`avg(extract(epoch from (${schema.requests.firstContactedAt} - ${schema.requests.createdAt})) / 60.0) FILTER (WHERE ${schema.requests.firstContactedAt} IS NOT NULL)`,
        medianMinutes: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from (${schema.requests.firstContactedAt} - ${schema.requests.createdAt})) / 60.0) FILTER (WHERE ${schema.requests.firstContactedAt} IS NOT NULL)`,
        p90Minutes: sql<number | null>`percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch from (${schema.requests.firstContactedAt} - ${schema.requests.createdAt})) / 60.0) FILTER (WHERE ${schema.requests.firstContactedAt} IS NOT NULL)`,
        breached: sql<number>`count(*) FILTER (WHERE ${schema.requests.firstContactedAt} IS NOT NULL AND extract(epoch from (${schema.requests.firstContactedAt} - ${schema.requests.createdAt})) / 60.0 > ${SLA_BREACH_MINUTES})::int`,
        answered: sql<number>`count(*) FILTER (WHERE ${schema.requests.firstContactedAt} IS NOT NULL)::int`,
        unanswered: sql<number>`count(*) FILTER (WHERE ${schema.requests.firstContactedAt} IS NULL)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      );

    const answered = Number(stats?.answered ?? 0);
    const breached = Number(stats?.breached ?? 0);
    return {
      avgMinutes: stats?.avgMinutes != null ? Number(stats.avgMinutes) : null,
      medianMinutes: stats?.medianMinutes != null ? Number(stats.medianMinutes) : null,
      p90Minutes: stats?.p90Minutes != null ? Number(stats.p90Minutes) : null,
      slaBreachRate: answered > 0 ? breached / answered : null,
      totalAnswered: answered,
      totalUnanswered: Number(stats?.unanswered ?? 0),
    };
  });
}

export const responseTimeStats = cacheClinicQuery(
  "responseTimeStats",
  responseTimeStatsUncached,
  { dateArgs: [0, 1] }
);

/** Daily mean response time in minutes. Missing days drop out. */
async function responseTimeSeriesUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<Array<{ date: string; avgMinutes: number }>> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        date: sql<string>`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        avgMinutes: sql<number>`avg(extract(epoch from (${schema.requests.firstContactedAt} - ${schema.requests.createdAt})) / 60.0)`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          isNotNull(schema.requests.firstContactedAt),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(sql`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);
    return rows.map((r) => ({ date: r.date, avgMinutes: Number(r.avgMinutes) }));
  });
}

export const responseTimeSeries = cacheClinicQuery(
  "responseTimeSeries",
  responseTimeSeriesUncached,
  { dateArgs: [0, 1] }
);

export interface AiScoreBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

async function aiScoreDistributionUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<AiScoreBucket[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [row] = await tx
      .select({
        b1: sql<number>`count(*) FILTER (WHERE ${schema.requests.aiScore} BETWEEN 0 AND 24)::int`,
        b2: sql<number>`count(*) FILTER (WHERE ${schema.requests.aiScore} BETWEEN 25 AND 49)::int`,
        b3: sql<number>`count(*) FILTER (WHERE ${schema.requests.aiScore} BETWEEN 50 AND 74)::int`,
        b4: sql<number>`count(*) FILTER (WHERE ${schema.requests.aiScore} BETWEEN 75 AND 100)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      );

    return [
      { label: "Sehr kalt", min: 0, max: 24, count: Number(row?.b1 ?? 0) },
      { label: "Kalt", min: 25, max: 49, count: Number(row?.b2 ?? 0) },
      { label: "Warm", min: 50, max: 74, count: Number(row?.b3 ?? 0) },
      { label: "Sehr heiß", min: 75, max: 100, count: Number(row?.b4 ?? 0) },
    ];
  });
}

export const aiScoreDistribution = cacheClinicQuery(
  "aiScoreDistribution",
  aiScoreDistributionUncached,
  { dateArgs: [0, 1] }
);

export interface WeekdayBucket {
  /** 0=Sun … 6=Sat (matches PG dow). */
  dow: number;
  label: string;
  count: number;
}

const WEEKDAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

async function weekdayHeatmapUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<WeekdayBucket[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        dow: sql<number>`extract(dow from ${schema.requests.createdAt})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(sql`extract(dow from ${schema.requests.createdAt})`);

    const counts = new Map<number, number>(rows.map((r) => [Number(r.dow), Number(r.count)]));
    return WEEKDAY_LABELS.map((label, dow) => ({
      dow,
      label,
      count: counts.get(dow) ?? 0,
    }));
  });
}

export const weekdayHeatmap = cacheClinicQuery(
  "weekdayHeatmap",
  weekdayHeatmapUncached,
  { dateArgs: [0, 1] }
);

export interface HourBucket {
  hour: number;
  count: number;
}

async function hourlyHeatmapUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<HourBucket[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        hour: sql<number>`extract(hour from ${schema.requests.createdAt})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(sql`extract(hour from ${schema.requests.createdAt})`);

    const counts = new Map<number, number>(rows.map((r) => [Number(r.hour), Number(r.count)]));
    const out: HourBucket[] = [];
    for (let h = 0; h < 24; h++) out.push({ hour: h, count: counts.get(h) ?? 0 });
    return out;
  });
}

export const hourlyHeatmap = cacheClinicQuery(
  "hourlyHeatmap",
  hourlyHeatmapUncached,
  { dateArgs: [0, 1] }
);

export interface CohortRow {
  /** ISO week (e.g. "2026-W17"). */
  cohort: string;
  cohortStart: string;
  size: number;
  /** Won within N days. */
  wonW1: number;
  wonW2: number;
  wonW4: number;
  wonW8: number;
  wonRateW8: number | null;
}

async function cohortRetentionUncached(
  clinicId: string,
  userId: string,
  weeks = 8
): Promise<CohortRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx.execute(sql`
      WITH cohorts AS (
        SELECT
          date_trunc('week', created_at) AS cohort_start,
          to_char(date_trunc('week', created_at), 'IYYY-"W"IW') AS cohort,
          id,
          created_at,
          won_at
        FROM requests
        WHERE clinic_id = ${clinicId}
          AND created_at >= now() - (interval '1 week' * ${weeks + 1})
      )
      SELECT
        cohort,
        min(cohort_start)::date::text AS cohort_start,
        count(*)::int AS size,
        count(*) FILTER (WHERE won_at IS NOT NULL AND won_at <= cohort_start + interval '1 week')::int AS won_w1,
        count(*) FILTER (WHERE won_at IS NOT NULL AND won_at <= cohort_start + interval '2 week')::int AS won_w2,
        count(*) FILTER (WHERE won_at IS NOT NULL AND won_at <= cohort_start + interval '4 week')::int AS won_w4,
        count(*) FILTER (WHERE won_at IS NOT NULL AND won_at <= cohort_start + interval '8 week')::int AS won_w8
      FROM cohorts
      GROUP BY cohort
      ORDER BY cohort DESC
      LIMIT ${weeks}
    `);

    return (rows as unknown as Array<{
      cohort: string;
      cohort_start: string;
      size: number;
      won_w1: number;
      won_w2: number;
      won_w4: number;
      won_w8: number;
    }>).map((r) => {
      const size = Number(r.size);
      const wonW8 = Number(r.won_w8);
      return {
        cohort: r.cohort,
        cohortStart: r.cohort_start,
        size,
        wonW1: Number(r.won_w1),
        wonW2: Number(r.won_w2),
        wonW4: Number(r.won_w4),
        wonW8,
        wonRateW8: size > 0 ? wonW8 / size : null,
      };
    });
  });
}

export const cohortRetention = cacheClinicQuery(
  "cohortRetention",
  cohortRetentionUncached
);

export interface StaffPerformanceRow {
  userId: string;
  fullName: string | null;
  email: string;
  role: string;
  assignedCount: number;
  wonCount: number;
  winRate: number | null;
  avgResponseMinutes: number | null;
  avgCaseValueEur: number | null;
}

export async function staffPerformance(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<StaffPerformanceRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        userId: schema.clinicUsers.id,
        fullName: schema.clinicUsers.fullName,
        email: schema.clinicUsers.email,
        role: schema.clinicUsers.role,
        assignedCount: sql<number>`count(${schema.requests.id})::int`,
        wonCount: sql<number>`count(${schema.requests.id}) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
        avgResponseMinutes: sql<number | null>`avg(extract(epoch from (${schema.requests.firstContactedAt} - ${schema.requests.createdAt})) / 60.0) FILTER (WHERE ${schema.requests.firstContactedAt} IS NOT NULL)`,
        revenueEur: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}) FILTER (WHERE ${schema.requests.status} = 'gewonnen'), 0)`,
      })
      .from(schema.clinicUsers)
      .leftJoin(
        schema.requests,
        and(
          eq(schema.requests.assignedTo, schema.clinicUsers.id),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .where(eq(schema.clinicUsers.clinicId, clinicId))
      .groupBy(
        schema.clinicUsers.id,
        schema.clinicUsers.fullName,
        schema.clinicUsers.email,
        schema.clinicUsers.role
      )
      .orderBy(sql`count(${schema.requests.id}) desc`);

    return rows.map((r) => {
      const assigned = Number(r.assignedCount);
      const won = Number(r.wonCount);
      const revenue = Number(r.revenueEur);
      return {
        userId: r.userId,
        fullName: r.fullName,
        email: r.email,
        role: r.role,
        assignedCount: assigned,
        wonCount: won,
        winRate: assigned > 0 ? won / assigned : null,
        avgResponseMinutes:
          r.avgResponseMinutes != null ? Number(r.avgResponseMinutes) : null,
        avgCaseValueEur: won > 0 ? Number((revenue / won).toFixed(2)) : null,
      };
    });
  });
}
