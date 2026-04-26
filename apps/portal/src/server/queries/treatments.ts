import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";

/**
 * Treatment-category helpers. The treatments table is per-clinic and
 * categorizes inbound requests via a simple keyword classifier.
 */

export interface TreatmentRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  displayOrder: number;
  defaultRecallMonths: number | null;
  keywords: string | null;
}

/** All active treatments for a clinic, ordered for UI dropdowns. */
export async function listTreatments(
  clinicId: string,
  userId: string
): Promise<TreatmentRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    return await tx
      .select({
        id: schema.treatments.id,
        name: schema.treatments.name,
        slug: schema.treatments.slug,
        isActive: schema.treatments.isActive,
        displayOrder: schema.treatments.displayOrder,
        defaultRecallMonths: schema.treatments.defaultRecallMonths,
        keywords: schema.treatments.keywords,
      })
      .from(schema.treatments)
      .where(
        and(
          eq(schema.treatments.clinicId, clinicId),
          isNull(schema.treatments.archivedAt)
        )
      )
      .orderBy(asc(schema.treatments.displayOrder), asc(schema.treatments.name));
  });
}

/**
 * Categorize a freeform treatment_wish text against the clinic's treatments.
 * Returns the matching treatment id, or NULL if nothing matched.
 */
export async function categorizeTreatmentWish(
  clinicId: string,
  userId: string | null,
  wish: string | null
): Promise<string | null> {
  if (!wish) return null;
  const lc = wish.toLowerCase();
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.treatments.id,
        keywords: schema.treatments.keywords,
        slug: schema.treatments.slug,
      })
      .from(schema.treatments)
      .where(
        and(
          eq(schema.treatments.clinicId, clinicId),
          isNull(schema.treatments.archivedAt)
        )
      );
    let fallbackId: string | null = null;
    for (const r of rows) {
      if (r.slug === "sonstige") fallbackId = r.id;
      if (!r.keywords) continue;
      for (const kw of r.keywords.split(",").map((k) => k.trim().toLowerCase())) {
        if (!kw) continue;
        if (lc.includes(kw)) return r.id;
      }
    }
    return fallbackId;
  });
}
