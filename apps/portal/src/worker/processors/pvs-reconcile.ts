import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueuePvsStatusDerive } from "@/server/jobs";
import { writeAudit } from "@/server/audit";

/**
 * Reconciliation — verify that derived state matches event-log reality
 * and that bridges are alive.
 *
 * Three checks:
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
 *   3. Stale-bridge check: pvs_link rows in status='connected' with
 *      last_event_at older than STALE_BRIDGE_THRESHOLD_HOURS. Could be a
 *      broken adapter, expired credentials, or a clinic that simply hasn't
 *      had appointments today. Writes an audit row per stale link; we
 *      debounce by skipping links we already audited as stale today.
 *
 * Logs per-clinic counts.
 */

const STALE_BRIDGE_THRESHOLD_HOURS = 6;

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

  // 3. Stale-bridge check.
  const staleCutoff = new Date(
    Date.now() - STALE_BRIDGE_THRESHOLD_HOURS * 60 * 60 * 1000
  );
  const staleLinks = await db
    .select({
      id: schema.pvsLink.id,
      clinicId: schema.pvsLink.clinicId,
      vendor: schema.pvsLink.pvsVendor,
      lastEventAt: schema.pvsLink.lastEventAt,
    })
    .from(schema.pvsLink)
    .where(
      and(
        eq(schema.pvsLink.status, "connected"),
        job.clinicId
          ? eq(schema.pvsLink.clinicId, job.clinicId)
          : sql`1 = 1`,
        // Either never sent an event, or last event is past the threshold.
        sql`(${schema.pvsLink.lastEventAt} IS NULL OR ${schema.pvsLink.lastEventAt} < ${staleCutoff})`
      )
    );

  let staleAudited = 0;
  for (const link of staleLinks) {
    // Debounce: skip if we already wrote a `pvs_bridge_stale` audit for
    // this clinic in the last STALE_BRIDGE_THRESHOLD_HOURS window. Without
    // this, every reconcile run would re-fire while the bridge is dead.
    const alreadyAudited = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM audit_log
      WHERE clinic_id = ${link.clinicId}
        AND action = 'pvs_bridge_stale'
        AND created_at > now() - INTERVAL '${sql.raw(
          // injection-reviewed (pentest L12): STALE_BRIDGE_THRESHOLD_HOURS is a
          // numeric module constant, so String() of it is digits only. A
          // Postgres INTERVAL literal cannot take a bind parameter inside the
          // quoted string, hence sql.raw on a non-user value.
          String(STALE_BRIDGE_THRESHOLD_HOURS)
        )} hours'
    `);
    const alreadyCount = Number(
      (alreadyAudited as unknown as Array<{ count: string }>)[0]?.count ?? "0"
    );
    if (alreadyCount > 0) continue;

    await writeAudit({
      clinicId: link.clinicId,
      action: "pvs_bridge_stale",
      entityKind: "pvs_link",
      entityId: link.id,
      diff: {
        vendor: link.vendor,
        lastEventAt: link.lastEventAt?.toISOString() ?? null,
        thresholdHours: STALE_BRIDGE_THRESHOLD_HOURS,
      },
    });
    staleAudited += 1;
  }

  console.log(
    `[pvs-reconcile] re-enqueued=${reEnqueued} orphans-queued=${orphansQueued} stale-bridges=${staleAudited}`
  );
}
