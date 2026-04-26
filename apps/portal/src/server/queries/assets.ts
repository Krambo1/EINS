import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withClinicContext, db, schema } from "@/db/client";
import type { AssetKind } from "@/lib/constants";

/**
 * Fetch clinic-visible assets. RLS already scopes by clinic_id; we also
 * filter by superseded version so only the latest of each lineage appears.
 */
export async function listAssets(
  clinicId: string,
  userId: string,
  options: { kind?: AssetKind } = {}
) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const clauses = [eq(schema.assets.clinicId, clinicId)];
    if (options.kind) clauses.push(eq(schema.assets.kind, options.kind));

    return await tx
      .select()
      .from(schema.assets)
      .where(and(...clauses))
      .orderBy(desc(schema.assets.createdAt));
  });
}

export async function getAsset(clinicId: string, userId: string, id: string) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, id))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Animation library joined with per-clinic customization state.
 * Returns every library entry; `instance` is null if the clinic hasn't
 * interacted with that animation yet.
 */
export async function listAnimationsForClinic(clinicId: string, userId: string) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const library = await tx
      .select()
      .from(schema.animationLibrary)
      .where(isNull(schema.animationLibrary.archivedAt))
      .orderBy(schema.animationLibrary.title);

    const instances = await tx
      .select()
      .from(schema.animationInstances)
      .where(eq(schema.animationInstances.clinicId, clinicId));

    const byLibraryId = new Map(instances.map((i) => [i.libraryId, i]));

    return library.map((lib) => ({
      library: lib,
      instance: byLibraryId.get(lib.id) ?? null,
    }));
  });
}

/** Global animation library — no clinic_id, no RLS. Safe to read via superuser. */
export async function getAnimationLibraryEntry(id: string) {
  const [row] = await db
    .select()
    .from(schema.animationLibrary)
    .where(eq(schema.animationLibrary.id, id))
    .limit(1);
  return row ?? null;
}
