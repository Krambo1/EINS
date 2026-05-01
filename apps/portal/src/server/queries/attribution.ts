import "server-only";
import { and, eq, gte, lte, sql, isNotNull } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { cacheClinicQuery } from "./_cache";

/**
 * Attribution helpers — break leads/revenue/spend down by source, channel,
 * campaign, treatment, and location. Used by Detail-mode breakdown tables on
 * Auswertung.
 *
 * Spend is approximated by mapping `requests.source` → `campaign_snapshots.platform`
 * (meta → meta, google → google). Sources without a matching platform get NULL.
 */

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export interface SourceBreakdownRow {
  source: string;
  leads: number;
  appointments: number;
  consultations: number;
  casesWon: number;
  revenueEur: number;
  spendEur: number | null;
  cpqlEur: number | null;
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
      cpqlEur: spend != null && r.leads > 0 ? Number((spend / r.leads).toFixed(2)) : null,
      cacEur:
        spend != null && r.casesWon > 0 ? Number((spend / r.casesWon).toFixed(2)) : null,
      roas:
        spend != null && spend > 0
          ? Number((r.revenueEur / spend).toFixed(2))
          : null,
    };
  });
}

const SOURCE_TO_PLATFORM: Record<string, "meta" | "google" | null> = {
  meta: "meta",
  meta_lead_form: "meta",
  google: "google",
  google_form: "google",
  formular: null,
  manuell: null,
  whatsapp: null,
  empfehlung: null,
  direkt: null,
};

/** Per-source breakdown of leads, conversions, and (best-effort) spend. */
async function bySourceUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<SourceBreakdownRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const requestRows = await tx
      .select({
        source: schema.requests.source,
        leads: sql<number>`count(*) FILTER (WHERE ${schema.requests.aiCategory} != 'cold' OR ${schema.requests.status} != 'spam')::int`,
        appointments: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('termin_vereinbart','beratung_erschienen','gewonnen'))::int`,
        consultations: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('beratung_erschienen','gewonnen'))::int`,
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
      .groupBy(schema.requests.source);

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

    const spendBySource = new Map<string, number>();
    for (const r of requestRows) {
      const platform = SOURCE_TO_PLATFORM[r.source];
      if (!platform) continue;
      const platformRow = platformSpend.find((p) => p.platform === platform);
      if (platformRow) spendBySource.set(r.source, Number(platformRow.spend));
    }

    return rollupRows(
      requestRows.map((r) => ({
        source: r.source,
        leads: Number(r.leads),
        appointments: Number(r.appointments),
        consultations: Number(r.consultations),
        casesWon: Number(r.casesWon),
        revenueEur: Number(r.revenueEur),
      })),
      spendBySource
    );
  });
}

export const bySource = cacheClinicQuery("bySource", bySourceUncached, {
  dateArgs: [0, 1],
});

const CHANNEL_FOR_SOURCE: Record<string, string> = {
  meta: "meta",
  meta_lead_form: "meta",
  google: "google",
  google_form: "google",
  formular: "direkt",
  manuell: "direkt",
  whatsapp: "direkt",
  empfehlung: "empfehlung",
};

/** Per-channel breakdown (meta / google / direkt / empfehlung). */
async function byChannelUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<SourceBreakdownRow[]> {
  const sourceRows = await bySource(clinicId, userId, from, to);
  const grouped = new Map<string, SourceBreakdownRow>();
  for (const r of sourceRows) {
    const channel = CHANNEL_FOR_SOURCE[r.source] ?? r.source;
    const existing = grouped.get(channel);
    if (!existing) {
      grouped.set(channel, { ...r, source: channel });
    } else {
      existing.leads += r.leads;
      existing.appointments += r.appointments;
      existing.consultations += r.consultations;
      existing.casesWon += r.casesWon;
      existing.revenueEur += r.revenueEur;
      if (r.spendEur != null) {
        existing.spendEur = (existing.spendEur ?? 0) + r.spendEur;
      }
    }
  }
  // Recompute ratios after rollup.
  return Array.from(grouped.values()).map((row) => ({
    ...row,
    cpqlEur:
      row.spendEur != null && row.leads > 0
        ? Number((row.spendEur / row.leads).toFixed(2))
        : null,
    cacEur:
      row.spendEur != null && row.casesWon > 0
        ? Number((row.spendEur / row.casesWon).toFixed(2))
        : null,
    roas:
      row.spendEur != null && row.spendEur > 0
        ? Number((row.revenueEur / row.spendEur).toFixed(2))
        : null,
  }));
}

export const byChannel = cacheClinicQuery("byChannel", byChannelUncached, {
  dateArgs: [0, 1],
});

export interface CampaignBreakdownRow {
  campaignId: string;
  /** Best-effort campaign name from raw_payload, else campaign id. */
  campaignName: string;
  source: string;
  leads: number;
  casesWon: number;
  revenueEur: number;
}

/** Top campaigns by lead count. */
async function byCampaignUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date,
  limit = 10
): Promise<CampaignBreakdownRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        campaignId: schema.requests.sourceCampaignId,
        source: schema.requests.source,
        leads: sql<number>`count(*)::int`,
        casesWon: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
        revenueEur: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}) FILTER (WHERE ${schema.requests.status} = 'gewonnen'), 0)`,
        sampleName: sql<string | null>`(array_agg(${schema.requests.rawPayload}->>'campaign_name'))[1]`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          isNotNull(schema.requests.sourceCampaignId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(schema.requests.sourceCampaignId, schema.requests.source)
      .orderBy(sql`count(*) desc`)
      .limit(limit);

    return rows.map((r) => ({
      campaignId: r.campaignId ?? "—",
      campaignName: r.sampleName ?? r.campaignId ?? "—",
      source: r.source,
      leads: Number(r.leads),
      casesWon: Number(r.casesWon),
      revenueEur: Number(r.revenueEur),
    }));
  });
}

export const byCampaign = cacheClinicQuery("byCampaign", byCampaignUncached, {
  dateArgs: [0, 1],
});

export interface TreatmentBreakdownRow {
  treatmentId: string | null;
  treatmentName: string;
  leads: number;
  casesWon: number;
  revenueEur: number;
  /** Average revenue per won case. */
  avgCaseValueEur: number | null;
}

/** Per-treatment-category breakdown. NULL treatment_id rolls up to "Sonstige". */
async function byTreatmentUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<TreatmentBreakdownRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        treatmentId: schema.requests.treatmentId,
        treatmentName: sql<string>`coalesce(${schema.treatments.name}, 'Sonstige')`,
        leads: sql<number>`count(*)::int`,
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
      .groupBy(schema.requests.treatmentId, schema.treatments.name)
      .orderBy(sql`count(*) desc`);

    return rows.map((r) => {
      const won = Number(r.casesWon);
      const revenue = Number(r.revenueEur);
      return {
        treatmentId: r.treatmentId,
        treatmentName: r.treatmentName,
        leads: Number(r.leads),
        casesWon: won,
        revenueEur: revenue,
        avgCaseValueEur: won > 0 ? Number((revenue / won).toFixed(2)) : null,
      };
    });
  });
}

export const byTreatment = cacheClinicQuery("byTreatment", byTreatmentUncached, {
  dateArgs: [0, 1],
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
        leads: sql<number>`count(*)::int`,
        appointments: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('termin_vereinbart','beratung_erschienen','gewonnen'))::int`,
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
      .orderBy(sql`count(*) desc`);

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
});
