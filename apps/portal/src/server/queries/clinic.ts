import "server-only";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, schema } from "@/db/client";

/**
 * Header data for the portal shell -- displayed on every page in the (portal)
 * group. Cached because:
 *   - It runs on every navigation (layout-level fetch).
 *   - The fields rarely change (displayName, logo, plan).
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
  plan: string;
  logoUrl: string | null;
};

async function fetchClinicHeader(clinicId: string): Promise<ClinicHeader | null> {
  const [row] = await db
    .select({
      id: schema.clinics.id,
      displayName: schema.clinics.displayName,
      plan: schema.clinics.plan,
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
