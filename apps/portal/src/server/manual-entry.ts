import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { manualEntryLeadInput, type ManualEntry } from "@/lib/manual-entry";
import { persistLead, type PersistLeadResult } from "@/server/leads";

/** The chosen treatment is not an active treatment of this Praxis. */
export class UnknownTreatmentError extends Error {
  constructor() {
    super("Diese Behandlung gibt es in Ihrer Praxis nicht mehr. Bitte wählen Sie neu.");
    this.name = "UnknownTreatmentError";
  }
}

/**
 * One front-desk entry through persistLead (the only place that creates
 * requests). `clinicId` must come from the session, never from the form.
 * persistLead runs on the superuser handle like every producer, so the
 * treatment check here is scoped to `clinicId` explicitly: an id of another
 * Praxis resolves to nothing.
 */
export async function createManualRequest(
  clinicId: string,
  entry: ManualEntry
): Promise<PersistLeadResult> {
  let treatmentName: string | null = null;
  if (entry.treatmentId) {
    const [t] = await db
      .select({ name: schema.treatments.name })
      .from(schema.treatments)
      .where(
        and(
          eq(schema.treatments.id, entry.treatmentId),
          eq(schema.treatments.clinicId, clinicId),
          eq(schema.treatments.isActive, true),
          isNull(schema.treatments.archivedAt)
        )
      )
      .limit(1);
    if (!t) throw new UnknownTreatmentError();
    treatmentName = t.name;
  }
  return persistLead(clinicId, manualEntryLeadInput(entry, treatmentName));
}
