import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";
import { canonicalSource } from "@/lib/sources";

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

    // Keyed like bySource (reporting channel). first_touch_source keeps no
    // UTM, so Zielseite patients land in "direkt" here. Several raw sources can
    // share a channel, so sum first and divide once.
    const sums = new Map<string, { count: number; revenue: number }>();
    for (const r of rows) {
      if (!r.firstTouchSource) continue;
      const key = canonicalSource(r.firstTouchSource);
      const acc = sums.get(key) ?? { count: 0, revenue: 0 };
      acc.count += Number(r.patientCount);
      acc.revenue += Number(r.totalRevenueEur);
      sums.set(key, acc);
    }
    const out = new Map<string, number>();
    for (const [key, acc] of sums) {
      if (acc.count > 0) out.set(key, acc.revenue / acc.count);
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
