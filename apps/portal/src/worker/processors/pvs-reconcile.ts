import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueuePvsStatusDerive } from "@/server/jobs";

/**
 * Nightly reconciliation — verify that derived state matches event-log
 * reality.
 *
 * Two checks:
 *
 *   1. Orphan check: pvs_event_log rows whose pvsPatientId has no
 *      pvs_patient_map row AND no open linking_failure. Caused by races
 *      (event arrived while the patient row was being deleted, etc.).
 *      Action: insert linking_failure rows so the inbox surfaces them.
 *
 *   2. Stale-derive check: requests rows that have a pvs_appointment_id
 *      but no recent status update (event_log shows newer events than
 *      requests.status's matching activity row). Caused by a worker
 *      crash that lost the derive job. Action: re-enqueue derive.
 *
 * Logs per-clinic counts. Designed for daily run.
 */

export interface PvsReconcileJob {
  clinicId?: string; // optional scope; default = all
}

export async function processPvsReconcile(
  job: PvsReconcileJob = {}
): Promise<void> {
  // 1. Stale-derive check.
  const stale = await db.execute<{
    clinic_id: string;
    patient_id: string;
    request_id: string;
  }>(sql`
    SELECT DISTINCT r.clinic_id, r.patient_id, r.id AS request_id
    FROM requests r
    WHERE r.patient_id IS NOT NULL
      AND r.pvs_appointment_id IS NOT NULL
      AND ${job.clinicId ? sql`r.clinic_id = ${job.clinicId}` : sql`1=1`}
      AND EXISTS (
        SELECT 1
        FROM pvs_event_log e
        WHERE e.clinic_id = r.clinic_id
          AND (e.payload->>'pvsAppointmentId') = r.pvs_appointment_id
          AND e.occurred_at > (
            SELECT COALESCE(MAX(a.created_at), '1970-01-01'::timestamptz)
            FROM request_activities a
            WHERE a.request_id = r.id
              AND a.kind = 'status_change'
          )
      )
    LIMIT 500
  `);

  let reEnqueued = 0;
  for (const row of stale as unknown as Array<{ clinic_id: string; patient_id: string }>) {
    await enqueuePvsStatusDerive(row.clinic_id, row.patient_id);
    reEnqueued += 1;
  }

  // 2. Orphan-event check.
  const orphans = await db.execute(sql`
    SELECT DISTINCT e.clinic_id, e.payload->>'pvsPatientId' AS pvs_patient_id
    FROM pvs_event_log e
    WHERE ${job.clinicId ? sql`e.clinic_id = ${job.clinicId}` : sql`1=1`}
      AND e.payload->>'pvsPatientId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pvs_patient_map m
        WHERE m.clinic_id = e.clinic_id
          AND m.pvs_patient_id = e.payload->>'pvsPatientId'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM linking_failures f
        WHERE f.clinic_id = e.clinic_id
          AND f.pvs_patient_id = e.payload->>'pvsPatientId'
          AND f.status = 'open'
      )
    LIMIT 500
  `);

  // For each orphan, run the link-backfill processor (handles the
  // PatientUpserted lookup + Stage-3 retry). We don't insert linking_failures
  // here directly — the backfill worker is the single owner of that table.
  const { enqueuePvsLinkBackfill } = await import("@/server/jobs");
  let orphansQueued = 0;
  for (const o of orphans as unknown as Array<{
    clinic_id: string;
    pvs_patient_id: string;
  }>) {
    await enqueuePvsLinkBackfill(o.clinic_id, o.pvs_patient_id);
    orphansQueued += 1;
  }

  console.log(
    `[pvs-reconcile] re-enqueued=${reEnqueued} orphans-queued=${orphansQueued}`
  );
}
