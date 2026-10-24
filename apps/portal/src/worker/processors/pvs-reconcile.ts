import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueuePvsStatusDerive } from "@/server/jobs";
import { writeAudit } from "@/server/audit";
import { notifyOps } from "@/server/ops-alerts";
import { businessMsBetween, SILENT_STALL_BUSINESS_MS } from "@/server/pvs-agent-health";

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
 *   2. Stale-derive check (pass 2): a linked patient with an event INGESTED
 *      after the patient's pvs_derived_at (the start of its last derive run).
 *      Caused by a worker crash or a lost enqueue. Action: re-enqueue derive.
 *      Real lost derives first, then never-derived patients (NULL, i.e. the
 *      one-time pass-2 re-derive of history).
 *
 *   3. Stale-bridge check (pass 2): CLOUD links only (no pvs_agent_status
 *      row; agent links are watched by the heartbeat-based agent-health
 *      scan, which knows business hours) that delivered nothing for
 *      SILENT_STALL_BUSINESS_MS of Berlin business time. The old 6 h
 *      wall-clock rule emailed every Praxis every night and weekend, which
 *      trains the operator to ignore the one alert that matters.
 *
 *   4. Failing cloud sync: the cloud bridge (apps/bridge) no longer flips a
 *      failing link to status='error' (that state could never recover); it
 *      keeps retrying and records the failure in pvs_sync_status. A link
 *      that is still failing after FAILING_SYNC_THRESHOLD attempts gets an
 *      operator email (notifyOps is rate-limited per clinic and kind).
 *
 * Logs per-clinic counts.
 */

/** Debounce for the stale-bridge audit + email per clinic. */
const STALE_BRIDGE_DEBOUNCE_HOURS = 24;
/** Grace for the normal derive path before reconcile calls it lost. */
const DERIVE_GRACE_MINUTES = 10;

/** Pass 2: a cloud link is silent when it delivered nothing (or never
 *  anything since it was created) for two Berlin business days. Pure. */
export function cloudLinkIsSilent(
  lastEventAt: Date | null,
  createdAt: Date,
  now: Date
): boolean {
  return businessMsBetween(lastEventAt ?? createdAt, now) > SILENT_STALL_BUSINESS_MS;
}
/** Matches the bridge's FAIL_THRESHOLD default (15-minute retry cadence). */
const FAILING_SYNC_THRESHOLD = 10;

export interface PvsReconcileJob {
  clinicId?: string; // optional scope; default = all
}

export async function processPvsReconcile(
  job: PvsReconcileJob = {}
): Promise<void> {
  // 1. Stale-derive check (pass 2: ingested_at vs patients.pvs_derived_at;
  //    see migration 0091 for why occurred_at vs activity rows was wrong).
  const stale = await db.execute<{
    clinic_id: string;
    patient_id: string;
  }>(sql`
    SELECT m.clinic_id, m.portal_patient_id AS patient_id
    FROM pvs_patient_map m
    JOIN patients p ON p.id = m.portal_patient_id
    WHERE ${job.clinicId ? sql`m.clinic_id = ${job.clinicId}` : sql`1=1`}
      AND EXISTS (
        SELECT 1
        FROM pvs_event_log e
        WHERE e.clinic_id = m.clinic_id
          AND (e.payload->>'pvsPatientId') = m.pvs_patient_id
          AND e.ingested_at > COALESCE(p.pvs_derived_at, '-infinity'::timestamptz)
          AND e.ingested_at < now() - INTERVAL '${sql.raw(
            // injection-reviewed: numeric module constant, digits only.
            String(DERIVE_GRACE_MINUTES)
          )} minutes'
      )
    GROUP BY m.clinic_id, m.portal_patient_id, p.pvs_derived_at
    -- Never-derived first: after 0091 that is the one-time pass-2 backfill;
    -- live updates are derived at apply time, this is the catch-up.
    ORDER BY p.pvs_derived_at ASC NULLS FIRST
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

  // 3. Stale-bridge check (cloud links only, business time).
  const now = new Date();
  const connectedCloudLinks = await db
    .select({
      id: schema.pvsLink.id,
      clinicId: schema.pvsLink.clinicId,
      vendor: schema.pvsLink.pvsVendor,
      lastEventAt: schema.pvsLink.lastEventAt,
      createdAt: schema.pvsLink.createdAt,
    })
    .from(schema.pvsLink)
    .leftJoin(
      schema.pvsAgentStatus,
      eq(schema.pvsAgentStatus.clinicId, schema.pvsLink.clinicId)
    )
    .where(
      and(
        eq(schema.pvsLink.status, "connected"),
        job.clinicId
          ? eq(schema.pvsLink.clinicId, job.clinicId)
          : sql`1 = 1`,
        isNull(schema.pvsAgentStatus.clinicId)
      )
    );
  const staleLinks = connectedCloudLinks.filter((l) =>
    cloudLinkIsSilent(l.lastEventAt, l.createdAt, now)
  );

  let staleAudited = 0;
  for (const link of staleLinks) {
    // Debounce: skip if we already wrote a `pvs_bridge_stale` audit for
    // this clinic in the last STALE_BRIDGE_DEBOUNCE_HOURS window. Without
    // this, every reconcile run would re-fire while the bridge is dead.
    const alreadyAudited = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM audit_log
      WHERE clinic_id = ${link.clinicId}
        AND action = 'pvs_bridge_stale'
        AND created_at > now() - INTERVAL '${sql.raw(
          // injection-reviewed (pentest L12): STALE_BRIDGE_DEBOUNCE_HOURS is a
          // numeric module constant, so String() of it is digits only. A
          // Postgres INTERVAL literal cannot take a bind parameter inside the
          // quoted string, hence sql.raw on a non-user value.
          String(STALE_BRIDGE_DEBOUNCE_HOURS)
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
        thresholdBusinessHours: SILENT_STALL_BUSINESS_MS / 3_600_000,
      },
    });
    staleAudited += 1;
    // Inside the debounced branch: the audit row alone has no reader, so the
    // operator would never hear about a dead bridge. notifyOps never throws.
    const title = link.lastEventAt
      ? `PVS-Brücke (${link.vendor}) liefert seit ${link.lastEventAt.toLocaleString(
          "de-DE",
          { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }
        )} keine Daten`
      : `PVS-Brücke (${link.vendor}) hat noch nie Daten geliefert`;
    await notifyOps({
      clinicId: link.clinicId,
      kind: `pvs_bridge_stale:${link.vendor}`,
      severity: "high",
      title,
      body: `Die Cloud-Anbindung hat seit mehr als zwei Werktagen keine PVS-Ereignisse geliefert, ohne einen Fehler zu melden. Zugangsdaten und Berechtigungen beim PVS-Anbieter prüfen.`,
    });
  }

  // 4. Failing cloud sync (still failing: last error within the last hour).
  const failingLinks = await db
    .select({
      clinicId: schema.pvsLink.clinicId,
      vendor: schema.pvsLink.pvsVendor,
      failures: schema.pvsSyncStatus.consecutiveFailureCount,
      lastError: schema.pvsSyncStatus.lastError,
    })
    .from(schema.pvsSyncStatus)
    .innerJoin(schema.pvsLink, eq(schema.pvsLink.id, schema.pvsSyncStatus.pvsLinkId))
    .where(
      and(
        job.clinicId ? eq(schema.pvsLink.clinicId, job.clinicId) : sql`1 = 1`,
        sql`${schema.pvsSyncStatus.consecutiveFailureCount} >= ${FAILING_SYNC_THRESHOLD}`,
        sql`${schema.pvsSyncStatus.lastErrorAt} > now() - interval '1 hour'`
      )
    );
  for (const link of failingLinks) {
    await notifyOps({
      clinicId: link.clinicId,
      kind: `pvs_cloud_sync_failing:${link.vendor}`,
      severity: "high",
      title: `PVS-Cloud-Anbindung (${link.vendor}) schlägt seit ${link.failures} Versuchen fehl`,
      body: `Letzter Fehler: ${(link.lastError ?? "unbekannt").slice(0, 500)}`,
    });
  }

  console.log(
    `[pvs-reconcile] re-enqueued=${reEnqueued} orphans-queued=${orphansQueued} stale-bridges=${staleAudited} failing-cloud-syncs=${failingLinks.length}`
  );
}
