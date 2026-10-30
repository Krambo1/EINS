import "server-only";
import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { schema, type dbApp } from "@/db/client";
import { addIsoDays, berlinDay, berlinStartOfDay } from "@/lib/dashboard-range";
import { adInquiriesByDay, type AdInquiryDay } from "./_ad-inquiries";
import { costPerQualified, qualifiedCount } from "./_qualified";

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
   * Qualifizierte Anfragen (_qualified.ts) joined on source_campaign_id, the
   * unit of the Kennzahlen above and the Übersicht. Null when the platform sent
   * neither campaign id nor name (account-level spend): nothing can be
   * matched, which is not 0.
   */
  leads: number | null;
  /** Werbebudget ÷ those qualifizierte Anfragen (costPerQualified). */
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

    // Lead-side: qualifizierte Anfragen per source_campaign_id, so a campaign's
    // count and cost match the Kennzahlen and the Übersicht (spam is never
    // qualified).
    const leadRows = await tx
      .select({
        campaignId: schema.requests.sourceCampaignId,
        leads: qualifiedCount,
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
        cplEur: leads == null ? null : costPerQualified(spend, leads),
      });
    }
    return out.sort((a, b) => b.spendEur - a.spendEur).slice(0, 20);
  }
}

export type { AdInquiryDay } from "./_ad-inquiries";

/**
 * Anfragen per Berlin day that came in through a Meta or Google ad over the
 * last `days` days, each with its qualifizierte Anfragen (_ad-inquiries.ts).
 * The Werbebudget page shows these instead of the lead count the platforms
 * report, and divides the Werbebudget by `qualified`, so every page agrees.
 */
export async function adInquiriesByDayTx(
  tx: Tx,
  clinicId: string,
  days: number
): Promise<AdInquiryDay[]> {
  const win = berlinLastDays(days);
  return adInquiriesByDay(tx, clinicId, win.start, win.endExclusive);
}

export interface SyncHistoryRow {
  date: string;
  rowCount: number;
}

/** Recent sync activity per platform (proxy: distinct snapshot dates). */
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
