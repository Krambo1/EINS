import "server-only";
import { and, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { withClinicContext, schema, type dbApp } from "@/db/client";
import { addIsoDays, berlinDay, berlinStartOfDay } from "@/lib/dashboard-range";
import { adPlatformFor } from "@/lib/sources";
import { channelGroupBy, channelKeys, channelOfGroup } from "./_channel";

/**
 * Campaign-detail helpers — Detail-mode breakdowns on /werbebudget.
 *
 * Every helper has a `...Tx` body that runs on a given transaction, so the
 * Werbebudget page can run all of them in ONE `withClinicContext` (one
 * transaction, pipelined) instead of one transaction each.
 */

type Tx = typeof dbApp;

/**
 * "Last N days" as Berlin calendar days, today included: [today-(N-1), today].
 * `endExclusive` is 00:00 Berlin of tomorrow, for timestamptz columns.
 */
export function berlinLastDays(days: number, now: Date = new Date()) {
  const toDate = berlinDay(now);
  const fromDate = addIsoDays(toDate, -(days - 1));
  return {
    fromDate,
    toDate,
    start: berlinStartOfDay(fromDate),
    endExclusive: berlinStartOfDay(addIsoDays(toDate, 1)),
  };
}

export interface PlatformDailyRow {
  date: string;
  spendEur: number;
  leads: number;
  cplEur: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
}

export async function campaignDailyByPlatformTx(
  tx: Tx,
  clinicId: string,
  platform: "meta" | "google",
  days: number
): Promise<PlatformDailyRow[]> {
  {
    const win = berlinLastDays(days);
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
          gte(schema.campaignSnapshots.snapshotDate, win.fromDate),
          lte(schema.campaignSnapshots.snapshotDate, win.toDate)
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
  }
}

export interface CampaignDetailRow {
  campaignId: string;
  campaignName: string;
  platform: string;
  spendEur: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  /**
   * Anfragen joined on source_campaign_id. Null when the platform sent neither
   * campaign id nor name (account-level spend): nothing can be matched, which
   * is not 0.
   */
  leads: number | null;
  cplEur: number | null;
}

export async function campaignsForPeriodTx(
  tx: Tx,
  clinicId: string,
  days: number
): Promise<CampaignDetailRow[]> {
  {
    const win = berlinLastDays(days);

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
          gte(schema.campaignSnapshots.snapshotDate, win.fromDate),
          lte(schema.campaignSnapshots.snapshotDate, win.toDate)
        )
      )
      .groupBy(
        schema.campaignSnapshots.platform,
        sql`(${schema.campaignSnapshots.rawPayload}->>'campaign_name')`,
        sql`(${schema.campaignSnapshots.rawPayload}->>'campaign_id')`
      );

    // Lead-side: requests grouped by source_campaign_id (spam excluded, like
    // every other Anfragen count).
    const leadRows = await tx
      .select({
        campaignId: schema.requests.sourceCampaignId,
        leads: sql<number>`count(*) filter (where ${schema.requests.status} <> 'spam')::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, win.start),
          lt(schema.requests.createdAt, win.endExclusive)
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
      const campaignId = s.campaignId ?? s.campaignName ?? "–";
      const matchKey = s.campaignId ?? s.campaignName;
      const leads = matchKey ? (leadByCampaign.get(matchKey) ?? 0) : null;
      out.push({
        campaignId,
        // Snapshot without campaign id and name (account-level spend): say so
        // instead of a bare dash (VD3).
        campaignName: s.campaignName ?? s.campaignId ?? "Ohne Kampagnenangabe",
        platform: s.platform,
        spendEur: spend,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : null,
        leads,
        cplEur: leads ? Number((spend / leads).toFixed(2)) : null,
      });
    }
    return out.sort((a, b) => b.spendEur - a.spendEur).slice(0, 20);
  }
}

export interface AdInquiryDay {
  date: string;
  platform: "meta" | "google";
  inquiries: number;
}

/**
 * Anfragen per Berlin day that came in through a Meta or Google ad, counted
 * in the portal (spam excluded) with the same channel rule as the dashboard
 * (bySource, reportingChannel). The Werbebudget page shows this number
 * instead of the lead count the platforms report, so every page agrees.
 */
export async function adInquiriesByDayTx(
  tx: Tx,
  clinicId: string,
  days: number
): Promise<AdInquiryDay[]> {
  const win = berlinLastDays(days);
  const berlinDate = sql<string>`to_char((${schema.requests.createdAt} AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD')`;
  const rows = await tx
    .select({
      ...channelKeys,
      date: berlinDate,
      inquiries: sql<number>`count(*)::int`,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        ne(schema.requests.status, "spam"),
        gte(schema.requests.createdAt, win.start),
        lt(schema.requests.createdAt, win.endExclusive)
      )
    )
    .groupBy(...channelGroupBy, berlinDate);

  const byDay = new Map<string, AdInquiryDay>();
  for (const r of rows) {
    const platform = adPlatformFor(channelOfGroup(r));
    if (!platform) continue;
    const key = `${platform}|${r.date}`;
    const day = byDay.get(key) ?? { date: r.date, platform, inquiries: 0 };
    day.inquiries += Number(r.inquiries);
    byDay.set(key, day);
  }
  return Array.from(byDay.values());
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
  return withClinicContext(clinicId, userId, (tx) =>
    syncHistoryTx(tx, clinicId, platform, limit)
  );
}

export async function syncHistoryTx(
  tx: Tx,
  clinicId: string,
  platform: "meta" | "google",
  limit = 10
): Promise<SyncHistoryRow[]> {
  {
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
  }
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

export async function spendPaceProjectionTx(
  tx: Tx,
  clinicId: string
): Promise<SpendPaceProjection> {
  {
    // Berlin calendar month: on the 1st between 00:00 and 02:00 Berlin the
    // server (UTC) is still in the previous month.
    const today = berlinDay();
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const monthStartStr = `${today.slice(0, 7)}-01`;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEndStr = `${today.slice(0, 7)}-${String(daysInMonth).padStart(2, "0")}`;
    const daysElapsed = Math.max(1, d);

    const [spendRow] = await tx
      .select({
        spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, monthStartStr),
          lte(schema.campaignSnapshots.snapshotDate, monthEndStr)
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
          lte(schema.goals.periodStart, today),
          gte(schema.goals.periodEnd, today)
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
  }
}
