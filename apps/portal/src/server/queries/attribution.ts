import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";
import { berlinDay } from "@/lib/dashboard-range";
import { adPlatformFor } from "@/lib/sources";
import { channelGroupBy, channelKeys, channelOfGroup } from "./_channel";

/**
 * Attribution helpers — break leads/revenue/spend down by source, channel,
 * campaign, treatment, and location. Used by Detail-mode breakdown tables on
 * Auswertung.
 *
 * Rows are bucketed by reporting channel (lib/sources.ts reportingChannel):
 * entry point plus UTM, so organic Instagram/Facebook/TikTok, profile-link and
 * DM-link inquiries sit next to paid Meta/Google instead of inside them.
 * Spend is approximated by mapping the paid buckets to
 * `campaign_snapshots.platform` (meta_anzeige → meta, google_anzeige → google).
 * Buckets without an ad platform get NULL.
 */

// Berlin calendar day: the dashboard windows start at 00:00 Berlin, which is
// still the previous UTC date (22:00/23:00Z), so a UTC slice would pull in an
// extra day of spend.
const dateStr = (d: Date) => berlinDay(d);

export interface SourceBreakdownRow {
  source: string;
  leads: number;
  appointments: number;
  consultations: number;
  casesWon: number;
  revenueEur: number;
  spendEur: number | null;
  cplEur: number | null;
  cacEur: number | null;
  roas: number | null;
}

function rollupRows(
  rows: Array<{
    source: string;
    leads: number;
    appointments: number;
    consultations: number;
    casesWon: number;
    revenueEur: number;
  }>,
  spendBy: Map<string, number>
): SourceBreakdownRow[] {
  return rows.map((r) => {
    const spend = spendBy.get(r.source) ?? null;
    return {
      ...r,
      spendEur: spend,
      cplEur: spend != null && r.leads > 0 ? Number((spend / r.leads).toFixed(2)) : null,
      cacEur:
        spend != null && r.casesWon > 0 ? Number((spend / r.casesWon).toFixed(2)) : null,
      roas:
        spend != null && spend > 0
          ? Number((r.revenueEur / spend).toFixed(2))
          : null,
    };
  });
}

/** Per-channel breakdown of leads, conversions, and (best-effort) spend. `source` holds the ReportingChannel key. */
async function bySourceUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<SourceBreakdownRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const requestRows = await tx
      .select({
        ...channelKeys,
        leads: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} <> 'spam')::int`,
        appointments: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('termin_vereinbart','beratung_erschienen','behandelt','gewonnen'))::int`,
        consultations: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('beratung_erschienen','behandelt','gewonnen'))::int`,
        casesWon: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
        revenueEur: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}) FILTER (WHERE ${schema.requests.status} = 'gewonnen'), 0)`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(...channelGroupBy);

    const platformSpend = await tx
      .select({
        platform: schema.campaignSnapshots.platform,
        spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, dateStr(from)),
          lte(schema.campaignSnapshots.snapshotDate, dateStr(to))
        )
      )
      .groupBy(schema.campaignSnapshots.platform);

    const byChannelKey = new Map<
      string,
      {
        source: string;
        leads: number;
        appointments: number;
        consultations: number;
        casesWon: number;
        revenueEur: number;
      }
    >();
    for (const r of requestRows) {
      const channel = channelOfGroup(r);
      const row = byChannelKey.get(channel) ?? {
        source: channel,
        leads: 0,
        appointments: 0,
        consultations: 0,
        casesWon: 0,
        revenueEur: 0,
      };
      row.leads += Number(r.leads);
      row.appointments += Number(r.appointments);
      row.consultations += Number(r.consultations);
      row.casesWon += Number(r.casesWon);
      row.revenueEur += Number(r.revenueEur);
      byChannelKey.set(channel, row);
    }

    const spendBySource = new Map<string, number>();
    for (const channel of byChannelKey.keys()) {
      const platform = adPlatformFor(channel);
      if (!platform) continue;
      const platformRow = platformSpend.find((p) => p.platform === platform);
      if (platformRow) spendBySource.set(channel, Number(platformRow.spend));
    }

    return rollupRows(
      Array.from(byChannelKey.values()).sort((a, b) => b.leads - a.leads),
      spendBySource
    );
  });
}

export const bySource = cacheClinicQuery("bySource", bySourceUncached, {
  dateArgs: [0, 1],
  // Live data and no worker to bust the tag: keep staleness to ~30 s.
  revalidate: SHORT_REVALIDATE_S,
});

export interface TreatmentBreakdownRow {
  treatmentId: string | null;
  treatmentName: string;
  leads: number;
  casesWon: number;
  revenueEur: number;
  /** Average revenue per won case. */
  avgCaseValueEur: number | null;
  /**
   * Werbeertrag (ROAS) for this treatment: revenue ÷ ad budget *allocated* to
   * the treatment. Spend isn't tracked per Behandlung, so the window's total ad
   * spend is split across treatments by their share of paid (meta/google)
   * Anfragen — organic/referral leads consumed no budget. null when there is no
   * spend, or no paid leads to attribute it to.
   */
  roas: number | null;
}

/** Per-treatment-category breakdown. NULL treatment_id rolls up to "Sonstige". */
async function byTreatmentUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<TreatmentBreakdownRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const groupRows = await tx
      .select({
        treatmentId: schema.requests.treatmentId,
        treatmentName: sql<string>`coalesce(${schema.treatments.name}, 'Sonstige')`,
        ...channelKeys,
        leads: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} <> 'spam')::int`,
        casesWon: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
        revenueEur: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}) FILTER (WHERE ${schema.requests.status} = 'gewonnen'), 0)`,
      })
      .from(schema.requests)
      .leftJoin(
        schema.treatments,
        eq(schema.requests.treatmentId, schema.treatments.id)
      )
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(
        schema.requests.treatmentId,
        schema.treatments.name,
        ...channelGroupBy
      );

    // Collapse the channel split back to one row per treatment. Paid Anfragen
    // (channels with an ad platform; organic ones consume no budget) are the
    // basis for splitting ad spend across treatments below.
    const perTreatment = new Map<
      string,
      {
        treatmentId: string | null;
        treatmentName: string;
        leads: number;
        paidLeads: number;
        casesWon: number;
        revenueEur: number;
      }
    >();
    for (const r of groupRows) {
      const key = r.treatmentId ?? "__none__";
      const row = perTreatment.get(key) ?? {
        treatmentId: r.treatmentId,
        treatmentName: r.treatmentName,
        leads: 0,
        paidLeads: 0,
        casesWon: 0,
        revenueEur: 0,
      };
      const leads = Number(r.leads);
      row.leads += leads;
      if (adPlatformFor(channelOfGroup(r))) row.paidLeads += leads;
      row.casesWon += Number(r.casesWon);
      row.revenueEur += Number(r.revenueEur);
      perTreatment.set(key, row);
    }
    const rows = Array.from(perTreatment.values()).sort((a, b) => b.leads - a.leads);

    // Total ad spend in the window (same campaign-snapshot source as bySource).
    // There's no per-Behandlung spend column, so we allocate this pot across
    // treatments by paid-lead share to derive a per-treatment Werbeertrag.
    const spendRows = await tx
      .select({
        spend: sql<number>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)`,
      })
      .from(schema.campaignSnapshots)
      .where(
        and(
          eq(schema.campaignSnapshots.clinicId, clinicId),
          gte(schema.campaignSnapshots.snapshotDate, dateStr(from)),
          lte(schema.campaignSnapshots.snapshotDate, dateStr(to))
        )
      );
    const totalSpend = Number(spendRows[0]?.spend ?? 0);
    const totalPaidLeads = rows.reduce((s, r) => s + Number(r.paidLeads), 0);

    return rows.map((r) => {
      const won = Number(r.casesWon);
      const revenue = Number(r.revenueEur);
      const paidLeads = Number(r.paidLeads);
      // Split the window's ad spend by this treatment's share of paid Anfragen;
      // organic/referral leads cost no ad budget and so don't dilute it.
      // Werbeertrag = Umsatz ÷ zugeordnetes Budget.
      const allocatedSpend =
        totalSpend > 0 && totalPaidLeads > 0
          ? totalSpend * (paidLeads / totalPaidLeads)
          : 0;
      return {
        treatmentId: r.treatmentId,
        treatmentName: r.treatmentName,
        leads: Number(r.leads),
        casesWon: won,
        revenueEur: revenue,
        avgCaseValueEur: won > 0 ? Number((revenue / won).toFixed(2)) : null,
        roas:
          allocatedSpend > 0
            ? Number((revenue / allocatedSpend).toFixed(2))
            : null,
      };
    });
  });
}

export const byTreatment = cacheClinicQuery("byTreatment", byTreatmentUncached, {
  dateArgs: [0, 1],
  // Live data and no worker to bust the tag: keep staleness to ~30 s.
  revalidate: SHORT_REVALIDATE_S,
});

export interface LocationBreakdownRow {
  locationId: string | null;
  locationName: string;
  leads: number;
  appointments: number;
  casesWon: number;
  revenueEur: number;
}

/** Per-location breakdown. Returns single row when only one location is registered. */
async function byLocationUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<LocationBreakdownRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        locationId: schema.requests.locationId,
        locationName: sql<string>`coalesce(${schema.locations.name}, 'Ohne Standort')`,
        leads: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} <> 'spam')::int`,
        appointments: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('termin_vereinbart','beratung_erschienen','behandelt','gewonnen'))::int`,
        casesWon: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
        revenueEur: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}) FILTER (WHERE ${schema.requests.status} = 'gewonnen'), 0)`,
      })
      .from(schema.requests)
      .leftJoin(
        schema.locations,
        eq(schema.requests.locationId, schema.locations.id)
      )
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(schema.requests.locationId, schema.locations.name)
      .orderBy(sql`count(*) FILTER (WHERE ${schema.requests.status} <> 'spam') desc`);

    return rows.map((r) => ({
      locationId: r.locationId,
      locationName: r.locationName,
      leads: Number(r.leads),
      appointments: Number(r.appointments),
      casesWon: Number(r.casesWon),
      revenueEur: Number(r.revenueEur),
    }));
  });
}

export const byLocation = cacheClinicQuery("byLocation", byLocationUncached, {
  dateArgs: [0, 1],
  // Live data and no worker to bust the tag: keep staleness to ~30 s.
  revalidate: SHORT_REVALIDATE_S,
});
