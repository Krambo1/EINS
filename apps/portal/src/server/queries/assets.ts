import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { AssetKind } from "@/lib/constants";
import { sectionBadgeThreshold } from "./navBadges";

/**
 * Fetch clinic-visible assets, newest first. RLS already scopes by clinic_id.
 * Only the latest version of each lineage appears: a row that a newer upload
 * supersedes (`newer.supersedes_id = row.id`) is hidden, so the Praxis never
 * publishes an outdated version by accident.
 *
 * `limit` caps the page (D-18); callers fetch limit + 1 to know whether more
 * exist.
 */
export async function listAssets(
  clinicId: string,
  userId: string,
  options: { kind?: AssetKind; limit?: number } = {}
) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const clauses = [
      eq(schema.assets.clinicId, clinicId),
      sql`NOT EXISTS (
        SELECT 1 FROM assets newer
        WHERE newer.supersedes_id = ${schema.assets.id}
          AND newer.clinic_id = ${clinicId}
      )`,
    ];
    if (options.kind) clauses.push(eq(schema.assets.kind, options.kind));

    const q = tx
      .select()
      .from(schema.assets)
      .where(and(...clauses))
      .orderBy(desc(schema.assets.createdAt));
    return options.limit ? await q.limit(options.limit) : await q;
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

/**
 * Returns true iff a new asset has landed or an animation customization
 * has been delivered for this clinic since this user's last visit to
 * /medien. Drives the sidebar Medien "Neu" pill.
 */
export async function hasNewMedia(
  clinicId: string,
  userId: string
): Promise<boolean> {
  const threshold = await sectionBadgeThreshold(clinicId, userId, "medien");
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const newAssetsP = tx
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.clinicId, clinicId),
            gt(schema.assets.createdAt, threshold)
          )
        )
        .limit(1);
      // Animations don't have a created_at on `animation_instances`; the
      // user-visible "new" moment is when a customization becomes ready
      // (delivered_at moves from NULL to a timestamp).
      const newAnimationsP = tx
        .select({ id: schema.animationInstances.id })
        .from(schema.animationInstances)
        .where(
          and(
            eq(schema.animationInstances.clinicId, clinicId),
            isNotNull(schema.animationInstances.deliveredAt),
            gt(schema.animationInstances.deliveredAt, threshold)
          )
        )
        .limit(1);
      const [newAssets, newAnimations] = await Promise.all([
        newAssetsP,
        newAnimationsP,
      ]);
      return newAssets.length > 0 || newAnimations.length > 0;
    },
    "medien:has-new"
  );
}
