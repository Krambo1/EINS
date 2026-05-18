import "server-only";
import { eq, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, schema } from "@/db/client";

/**
 * Header data for the portal shell -- displayed on every page in the (portal)
 * group. Cached because:
 *   - It runs on every navigation (layout-level fetch).
 *   - The fields rarely change (displayName, logo).
 *   - The query is keyed by clinicId, so cross-tenant leak is impossible.
 *
 * Invalidation: every mutation that touches schema.clinics calls
 * `revalidateTag("clinic:<id>")` so the next read sees fresh data.
 *
 * Cache TTL is a 5-minute safety net — anything missing a tag refresh
 * will self-heal within that window.
 */
export type ClinicHeader = {
  id: string;
  displayName: string;
  logoUrl: string | null;
};

async function fetchClinicHeader(clinicId: string): Promise<ClinicHeader | null> {
  const [row] = await db
    .select({
      id: schema.clinics.id,
      displayName: schema.clinics.displayName,
      logoUrl: schema.clinics.logoUrl,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  return row ?? null;
}

export function getClinicHeader(clinicId: string): Promise<ClinicHeader | null> {
  // Bind clinicId into a scoped cache to keep the cache key explicit.
  return unstable_cache(
    () => fetchClinicHeader(clinicId),
    ["clinic-header", clinicId],
    {
      tags: [`clinic:${clinicId}`],
      revalidate: 300,
    }
  )();
}

/**
 * Earliest evidence that this Praxis has been working with EINS — used by
 * the dashboard to cap monthly-goal scaling so a clinic younger than the
 * selected window isn't compared against an unattainable target
 * (see `effectiveScalingDays`).
 *
 * `clinics.created_at` alone is unreliable: in demo / seeded environments
 * the clinic record is created today while requests + kpi_daily are
 * backfilled months back, which makes "Jahr" look like "3 days" of data.
 * Take the minimum of (clinic.created_at, earliest request, earliest
 * kpi_daily row) so the duration matches what the user actually sees in
 * their charts.
 *
 * Cached the same way as the header: the value only moves backwards (older
 * data arriving), and a 5-minute TTL is fine as a safety net.
 */
async function fetchClinicRelationshipStartIso(
  clinicId: string
): Promise<string | null> {
  // Single round-trip: pull the three candidate dates in one query and let
  // Postgres pick the minimum. Cast kpi_daily.date to timestamptz so LEAST
  // can compare it against the two timestamptz columns.
  const [row] = await db.execute<{ start_at: Date | null }>(sql`
    SELECT LEAST(
      c.created_at,
      (SELECT MIN(created_at) FROM requests WHERE clinic_id = ${clinicId}),
      (SELECT MIN(date)::timestamptz FROM kpi_daily WHERE clinic_id = ${clinicId})
    ) AS start_at
    FROM clinics c
    WHERE c.id = ${clinicId}
    LIMIT 1
  `);
  return row?.start_at ? new Date(row.start_at).toISOString() : null;
}

// unstable_cache serializes its return value — a Date round-trips as an ISO
// string, which then breaks `.getTime()` downstream. Cache the string and
// rehydrate to Date outside the cache.
export async function getClinicRelationshipStart(
  clinicId: string
): Promise<Date | null> {
  const iso = await unstable_cache(
    () => fetchClinicRelationshipStartIso(clinicId),
    ["clinic-relationship-start", clinicId],
    {
      // Invalidated alongside the rest of the clinic-scoped cache when
      // anything touches the clinic (header changes, etc.). New requests
      // arriving don't auto-bust the tag, but the 5-min TTL self-heals and
      // the duration is only displayed at coarse granularity (days/weeks/
      // months) — a few minutes of staleness is invisible.
      tags: [`clinic:${clinicId}`, `requests:${clinicId}`],
      revalidate: 300,
    }
  )();
  return iso ? new Date(iso) : null;
}
