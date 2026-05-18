import { backfillLinkFromHistory } from "@/server/pvs-linking";
import { enqueuePvsStatusDerive } from "@/server/jobs";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";

/**
 * PVS Bridge — Stage-3 fuzzy linker re-runner.
 *
 * Triggered by:
 *   • applyPvsEvent when it sees a non-PatientUpserted event for a PVS
 *     patient that has no map row yet. The expectation is that a
 *     PatientUpserted event will arrive later (or already exists earlier
 *     in event_log but hasn't been replayed in this clinic's lifetime).
 *   • The "Re-check" button on the linking-failures inbox UI.
 *   • The nightly reconciliation cron.
 *
 * After re-linking succeeds, status-derive is re-enqueued so the patient's
 * historical events finally land on the right portal patient.
 */

export interface PvsLinkBackfillJob {
  clinicId: string;
  pvsPatientId: string;
}

export async function processPvsLinkBackfill(
  job: PvsLinkBackfillJob
): Promise<void> {
  const { clinicId, pvsPatientId } = job;

  await backfillLinkFromHistory(clinicId, pvsPatientId);

  // If we now have a map row, enqueue derive so historical events apply.
  const [row] = await db
    .select({
      portalPatientId: schema.pvsPatientMap.portalPatientId,
    })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, clinicId),
        eq(schema.pvsPatientMap.pvsPatientId, pvsPatientId)
      )
    )
    .limit(1);

  if (row) {
    await enqueuePvsStatusDerive(clinicId, row.portalPatientId);
  }
}
