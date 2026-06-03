import "server-only";
import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";

/**
 * Patient + recall helpers — Detail-mode panels: Top LTV, LTV by channel,
 * upcoming recalls, sibling requests for a single patient.
 */

export interface TopPatientRow {
  patientId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  lifetimeRevenueEur: number;
  requestCount: number;
  wonCount: number;
  lastSeenAt: Date;
  firstTouchSource: string | null;
}

async function topPatientsByLtvUncached(
  clinicId: string,
  userId: string,
  limit = 10
): Promise<TopPatientRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        patientId: schema.patients.id,
        fullName: schema.patients.fullName,
        email: schema.patients.email,
        phone: schema.patients.phone,
        lifetimeRevenueEur: schema.patients.lifetimeRevenueEur,
        requestCount: schema.patients.requestCount,
        wonCount: schema.patients.wonCount,
        lastSeenAt: schema.patients.lastSeenAt,
        firstTouchSource: schema.patients.firstTouchSource,
      })
      .from(schema.patients)
      .where(eq(schema.patients.clinicId, clinicId))
      .orderBy(desc(schema.patients.lifetimeRevenueEur))
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      lifetimeRevenueEur: Number(r.lifetimeRevenueEur),
      requestCount: Number(r.requestCount),
      wonCount: Number(r.wonCount),
    }));
  });
}

export const topPatientsByLtv = cacheClinicQuery(
  "topPatientsByLtv",
  topPatientsByLtvUncached,
  {}
);

export interface LtvByChannelRow {
  channel: string;
  patientCount: number;
  totalRevenueEur: number;
  avgLtvEur: number | null;
}

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

async function ltvByChannelUncached(
  clinicId: string,
  userId: string
): Promise<LtvByChannelRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        firstTouchSource: schema.patients.firstTouchSource,
        patientCount: sql<number>`count(*)::int`,
        totalRevenueEur: sql<number>`coalesce(sum(${schema.patients.lifetimeRevenueEur}), 0)`,
      })
      .from(schema.patients)
      .where(eq(schema.patients.clinicId, clinicId))
      .groupBy(schema.patients.firstTouchSource);

    const grouped = new Map<string, LtvByChannelRow>();
    for (const r of rows) {
      const channel =
        (r.firstTouchSource && CHANNEL_FOR_SOURCE[r.firstTouchSource]) ??
        r.firstTouchSource ??
        "unbekannt";
      const existing = grouped.get(channel);
      const patientCount = Number(r.patientCount);
      const totalRev = Number(r.totalRevenueEur);
      if (!existing) {
        grouped.set(channel, {
          channel,
          patientCount,
          totalRevenueEur: totalRev,
          avgLtvEur: patientCount > 0 ? totalRev / patientCount : null,
        });
      } else {
        existing.patientCount += patientCount;
        existing.totalRevenueEur += totalRev;
      }
    }
    for (const v of grouped.values()) {
      v.avgLtvEur =
        v.patientCount > 0 ? Number((v.totalRevenueEur / v.patientCount).toFixed(2)) : null;
    }
    return Array.from(grouped.values()).sort(
      (a, b) => (b.avgLtvEur ?? 0) - (a.avgLtvEur ?? 0)
    );
  });
}

export const ltvByChannel = cacheClinicQuery(
  "ltvByChannel",
  ltvByChannelUncached,
  {}
);

/**
 * Average lifetime value keyed by raw first-touch source (the same source
 * vocabulary as `requests.source` / `bySource`), so it maps onto the
 * Quellen-Aufschlüsselung rows 1:1 — no collapsing into coarse channels the
 * way `ltvByChannel` does. Deliberately *not* window-scoped: LTV is a lifetime
 * metric, so it aggregates every patient regardless of the dashboard period.
 */
async function ltvBySourceUncached(
  clinicId: string,
  userId: string
): Promise<Map<string, number>> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        firstTouchSource: schema.patients.firstTouchSource,
        patientCount: sql<number>`count(*)::int`,
        totalRevenueEur: sql<number>`coalesce(sum(${schema.patients.lifetimeRevenueEur}), 0)`,
      })
      .from(schema.patients)
      .where(eq(schema.patients.clinicId, clinicId))
      .groupBy(schema.patients.firstTouchSource);

    const out = new Map<string, number>();
    for (const r of rows) {
      if (!r.firstTouchSource) continue;
      const count = Number(r.patientCount);
      if (count > 0) {
        out.set(r.firstTouchSource, Number(r.totalRevenueEur) / count);
      }
    }
    return out;
  });
}

/**
 * Cached for SHORT_REVALIDATE_S. Range-independent (LTV is a lifetime metric),
 * so the dashboard re-running it on every TimeRangeToggle is pure waste.
 * unstable_cache JSON-serializes its result and a Map round-trips to `{}`, so
 * we cache the entries array and rehydrate to a Map outside the cache (same
 * pattern as getClinicRelationshipStart's Date). Public signature unchanged.
 */
const ltvBySourceEntries = cacheClinicQuery(
  "ltvBySource",
  async (
    clinicId: string,
    userId: string
  ): Promise<Array<[string, number]>> =>
    Array.from((await ltvBySourceUncached(clinicId, userId)).entries()),
  { revalidate: SHORT_REVALIDATE_S }
);

export async function ltvBySource(
  clinicId: string,
  userId: string
): Promise<Map<string, number>> {
  return new Map(await ltvBySourceEntries(clinicId, userId));
}

/** Other requests for the same patient_id, excluding the given request. */
export async function siblingRequests(
  clinicId: string,
  userId: string,
  requestId: string
): Promise<
  Array<{
    id: string;
    treatmentWish: string | null;
    status: string;
    createdAt: Date;
    convertedRevenueEur: number | null;
  }>
> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [target] = await tx
      .select({ patientId: schema.requests.patientId })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);

    if (!target?.patientId) return [];

    const rows = await tx
      .select({
        id: schema.requests.id,
        treatmentWish: schema.requests.treatmentWish,
        status: schema.requests.status,
        createdAt: schema.requests.createdAt,
        convertedRevenueEur: schema.requests.convertedRevenueEur,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          eq(schema.requests.patientId, target.patientId),
          ne(schema.requests.id, requestId)
        )
      )
      .orderBy(desc(schema.requests.createdAt))
      .limit(10);

    return rows.map((r) => ({
      ...r,
      convertedRevenueEur:
        r.convertedRevenueEur != null ? Number(r.convertedRevenueEur) : null,
    }));
  });
}


/** Aggregate revenue for a single patient (for the Anfrage detail page). */
export async function patientLifetimeRevenue(
  clinicId: string,
  userId: string,
  patientId: string
): Promise<number | null> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [row] = await tx
      .select({
        ltv: schema.patients.lifetimeRevenueEur,
      })
      .from(schema.patients)
      .where(
        and(
          eq(schema.patients.id, patientId),
          eq(schema.patients.clinicId, clinicId)
        )
      )
      .limit(1);
    return row?.ltv != null ? Number(row.ltv) : null;
  });
}
