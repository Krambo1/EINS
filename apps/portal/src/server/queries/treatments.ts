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
