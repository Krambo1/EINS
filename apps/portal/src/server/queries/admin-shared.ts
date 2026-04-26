import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * React.cache-wrapped admin reads. The cache is request-scoped (resets
 * between requests) and de-duplicates calls within a single render.
 *
 * Why these helpers exist:
 *   /admin/clinics/[id] currently fetches the clinic record once, but
 *   any future code path (a tab subcomponent, a forthcoming admin
 *   breadcrumb, a sibling layout) that also needs the same clinic
 *   would otherwise re-issue the SELECT. React.cache makes the second
 *   call free without forcing callers to thread a prop.
 *
 * Pattern mirrors getSession()/getAdminSession() (auth/admin.ts:184)
 * which were wrapped on commit 05bf594 for the same reason.
 */

/** Single clinic by id. Returns null if not found. */
export const getAdminClinicById = cache(async (id: string) => {
  const [row] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, id))
    .limit(1);
  return row ?? null;
});

/** Aggregate counts shown on the clinic-detail Übersicht tab header. */
export const getAdminClinicCounts = cache(async (clinicId: string) => {
  const [row] = await db
    .select({
      requests: sql<number>`(
        select count(*)::int from ${schema.requests}
        where ${schema.requests.clinicId} = ${clinicId}
      )`,
      documents: sql<number>`(
        select count(*)::int from ${schema.documents}
        where ${schema.documents.clinicId} = ${clinicId}
      )`,
      assets: sql<number>`(
        select count(*)::int from ${schema.assets}
        where ${schema.assets.clinicId} = ${clinicId}
      )`,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  return row ?? { requests: 0, documents: 0, assets: 0 };
});
