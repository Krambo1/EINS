import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";

/**
 * Campaign-detail helpers — Detail-mode breakdowns on /werbebudget.
 */

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export interface PlatformDailyRow {
  date: string;
  spendEur: number;
  leads: number;
  cplEur: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
}

export async function campaignDailyByPlatform(
  clinicId: string,
  userId: string,
  platform: "meta" | "google",
  days: number
): Promise<PlatformDailyRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    const rows = await tx
      .select({
        date: schema.campaignSnapshots.snapshotDate,
        spendEur: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
        leads: sql<number>`coalesce(sum(${schema.campaignSnapshots.leads}), 0)::int`,
        impressions: sql<number>`coalesce(sum(${schema.campaignSnapshots.impressions}), 0)::int`,
        clicks: sql<number>`coalesce(sum(${schema.campaignSnapshots.clicks}), 0)::int`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          eq(schema.campaignSnapshots.platform, platform),
          gte(schema.campaignSnapshots.snapshotDate, dateStr(from)),
          lte(schema.campaignSnapshots.snapshotDate, dateStr(to))
        )
      )
      .groupBy(schema.campaignSnapshots.snapshotDate)
      .orderBy(schema.campaignSnapshots.snapshotDate);

    return rows.map((r) => {
      const spend = Number(r.spendEur);
      const leads = Number(r.leads);
      const impressions = Number(r.impressions);
      const clicks = Number(r.clicks);
      return {
        date: r.date,
        spendEur: spend,
        leads,
        cplEur: leads > 0 ? Number((spend / leads).toFixed(2)) : null,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : null,
      };
    });
  });
}

export interface CampaignDetailRow {
  campaignId: string;
  campaignName: string;
  platform: string;
  spendEur: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  /** Lead count derived from requests joined on source_campaign_id. */
  leads: number;
  cplEur: number | null;
}

/**
 * Per-campaign breakdown for the period, joining campaign_snapshots
 * (spend / impressions / clicks via raw_payload->>'campaign_name')
 * with requests (lead count via source_campaign_id).
 */
export async function campaignsForPeriod(
  clinicId: string,
  userId: string,
  days: number
): Promise<CampaignDetailRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);

    // Snapshot-side: aggregate spend/impressions/clicks per (platform, campaign_name).
    const snapshots = await tx
      .select({
        platform: schema.campaignSnapshots.platform,
        campaignName: sql<string | null>`(${schema.campaignSnapshots.rawPayload}->>'campaign_name')`,
        campaignId: sql<string | null>`(${schema.campaignSnapshots.rawPayload}->>'campaign_id')`,
        spendEur: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
        impressions: sql<number>`coalesce(sum(${schema.campaignSnapshots.impressions}), 0)::int`,
        clicks: sql<number>`coalesce(sum(${schema.campaignSnapshots.clicks}), 0)::int`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, dateStr(from)),
          lte(schema.campaignSnapshots.snapshotDate, dateStr(to))
        )
      )
      .groupBy(
        schema.campaignSnapshots.platform,
        sql`(${schema.campaignSnapshots.rawPayload}->>'campaign_name')`,
        sql`(${schema.campaignSnapshots.rawPayload}->>'campaign_id')`
      );

    // Lead-side: requests grouped by source_campaign_id.
    const leadRows = await tx
      .select({
        campaignId: schema.requests.sourceCampaignId,
        leads: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(schema.requests.sourceCampaignId);

    const leadByCampaign = new Map<string, number>();
    for (const r of leadRows) {
      if (r.campaignId) leadByCampaign.set(r.campaignId, Number(r.leads));
    }

    const out: CampaignDetailRow[] = [];
    for (const s of snapshots) {
      const spend = Number(s.spendEur);
      const impressions = Number(s.impressions);
      const clicks = Number(s.clicks);
      const campaignId = s.campaignId ?? s.campaignName ?? "—";
      const leads = leadByCampaign.get(campaignId) ?? 0;
      out.push({
        campaignId,
        campaignName: s.campaignName ?? campaignId,
        platform: s.platform,
        spendEur: spend,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : null,
        leads,
        cplEur: leads > 0 ? Number((spend / leads).toFixed(2)) : null,
      });
    }
    return out.sort((a, b) => b.spendEur - a.spendEur).slice(0, 20);
  });
}

export interface SyncHistoryRow {
  date: string;
  rowCount: number;
}

/** Recent sync activity per platform (proxy: distinct snapshot dates). */
export async function syncHistory(
  clinicId: string,
  userId: string,
  platform: "meta" | "google",
  limit = 10
): Promise<SyncHistoryRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        date: schema.campaignSnapshots.snapshotDate,
        rowCount: sql<number>`count(*)::int`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          eq(schema.campaignSnapshots.platform, platform)
        )
      )
      .groupBy(schema.campaignSnapshots.snapshotDate)
      .orderBy(desc(schema.campaignSnapshots.snapshotDate))
      .limit(limit);
    return rows.map((r) => ({ date: r.date, rowCount: Number(r.rowCount) }));
  });
}

/**
 * Pace projection — at the current daily run-rate, what's the projected
 * total spend by month-end vs the goal target. Returns NULL when no goal.
 */
export interface SpendPaceProjection {
  monthSpendSoFar: number;
  daysElapsed: number;
  daysInMonth: number;
  projectedMonthSpend: number;
  goalTargetEur: number | null;
  pacePct: number | null;
}

export async function spendPaceProjection(
  clinicId: string,
  userId: string
): Promise<SpendPaceProjection> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysElapsed = Math.max(1, now.getDate());
    const daysInMonth = monthEnd.getDate();

    const [spendRow] = await tx
      .select({
        spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, dateStr(monthStart)),
          lte(schema.campaignSnapshots.snapshotDate, dateStr(monthEnd))
        )
      );

    const monthSpendSoFar = Number(spendRow?.spend ?? 0);
    const projectedMonthSpend = (monthSpendSoFar / daysElapsed) * daysInMonth;

    const [goalRow] = await tx
      .select({ targetValue: schema.goals.targetValue })
      .from(schema.goals)
      .where(
        and(
          eq(schema.goals.clinicId, clinicId),
          eq(schema.goals.metric, "spend"),
          lte(schema.goals.periodStart, dateStr(now)),
          gte(schema.goals.periodEnd, dateStr(now))
        )
      )
      .limit(1);

    const goalTarget = goalRow ? Number(goalRow.targetValue) : null;
    const pacePct = goalTarget && goalTarget > 0 ? projectedMonthSpend / goalTarget : null;

    return {
      monthSpendSoFar,
      daysElapsed,
      daysInMonth,
      projectedMonthSpend: Number(projectedMonthSpend.toFixed(2)),
      goalTargetEur: goalTarget,
      pacePct,
    };
  });
}
