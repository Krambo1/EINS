import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * DSGVO-Werkzeuge (Art. 15 Auskunft / Art. 17 Löschung).
 *
 * Export: gibt ein JSON-Objekt zurück, das alle praxis-scopeten Tabellen
 * enthält. Kein Streaming nötig — die Datenmenge pro Praxis ist klein.
 *
 * Löschung (Erasure): hard delete aller praxisbezogenen Zeilen in
 * abhängiger Reihenfolge, anschließend der Praxis selbst. Audit wird vom
 * Aufrufer geschrieben.
 *
 * Beide Funktionen gehören in admin-gated Server-Actions / API-Routen.
 * Kein RLS-Bypass nötig — `db` ist der Superuser-Client.
 */

export interface DsgvoExport {
  exportedAt: string;
  clinic: unknown;
  users: unknown[];
  requests: unknown[];
  requestActivities: unknown[];
  assets: unknown[];
  animationInstances: unknown[];
  documents: unknown[];
  campaignSnapshots: unknown[];
  kpiDaily: unknown[];
  goals: unknown[];
  notifications: unknown[];
  hwgChecks: unknown[];
  platformCredentials: unknown[];
  patients: unknown[];
  patientFeedback: unknown[];
  reviews: unknown[];
  reviewEmailSchedule: unknown[];
  linkingFailures: unknown[];
  pvsEventLog: unknown[];
  pvsPatientMap: unknown[];
  auditLog: unknown[];
}

export async function exportClinicData(clinicId: string): Promise<DsgvoExport> {
  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");

  const users = await db
    .select({
      // Password-hashes are filtered out: they are cryptographic material,
      // not personal data the user asked for.
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
      role: schema.clinicUsers.role,
      invitedAt: schema.clinicUsers.invitedAt,
      lastLoginAt: schema.clinicUsers.lastLoginAt,
      createdAt: schema.clinicUsers.createdAt,
      archivedAt: schema.clinicUsers.archivedAt,
    })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.clinicId, clinicId));

  const requestsRaw = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.clinicId, clinicId));
  // Redact raw_payload (the full pre-Zod intake blob, which may carry fields
  // dropped from the typed columns) — the Art.15 export returns the typed
  // model, not the unminimised at-rest copy (pentest L1 / data-minimisation).
  const requests = requestsRaw.map((r) => ({ ...r, rawPayload: null }));

  const activities = requests.length
    ? await db
        .select()
        .from(schema.requestActivities)
        .where(
          inArray(
            schema.requestActivities.requestId,
            requests.map((r) => r.id)
          )
        )
    : [];

  const [
    assets,
    animationInstances,
    documents,
    campaignSnapshots,
    kpiDaily,
    goals,
    notifications,
    hwgChecks,
    platformCredentials,
    patients,
    patientFeedback,
    reviews,
    reviewEmailSchedule,
    linkingFailures,
    pvsEventLog,
    pvsPatientMap,
    auditLog,
  ] = await Promise.all([
    db.select().from(schema.assets).where(eq(schema.assets.clinicId, clinicId)),
    db
      .select()
      .from(schema.animationInstances)
      .where(eq(schema.animationInstances.clinicId, clinicId)),
    db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.clinicId, clinicId)),
    db
      .select()
      .from(schema.campaignSnapshots)
      .where(eq(schema.campaignSnapshots.clinicId, clinicId)),
    db
      .select()
      .from(schema.kpiDaily)
      .where(eq(schema.kpiDaily.clinicId, clinicId)),
    db.select().from(schema.goals).where(eq(schema.goals.clinicId, clinicId)),
    db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.clinicId, clinicId)),
    db
      .select()
      .from(schema.hwgChecks)
      .where(eq(schema.hwgChecks.clinicId, clinicId)),
    db
      .select({
        // Same redaction — tokens are secrets, not personal data.
        id: schema.platformCredentials.id,
        clinicId: schema.platformCredentials.clinicId,
        platform: schema.platformCredentials.platform,
        accountId: schema.platformCredentials.accountId,
        scopes: schema.platformCredentials.scopes,
        expiresAt: schema.platformCredentials.expiresAt,
        lastSyncedAt: schema.platformCredentials.lastSyncedAt,
        lastSyncError: schema.platformCredentials.lastSyncError,
        createdAt: schema.platformCredentials.createdAt,
      })
      .from(schema.platformCredentials)
      .where(eq(schema.platformCredentials.clinicId, clinicId)),
    // PHI tables omitted from the original export (pentest H11 / Art.15).
    db.select().from(schema.patients).where(eq(schema.patients.clinicId, clinicId)),
    db
      .select()
      .from(schema.patientFeedback)
      .where(eq(schema.patientFeedback.clinicId, clinicId)),
    db.select().from(schema.reviews).where(eq(schema.reviews.clinicId, clinicId)),
    db
      .select()
      .from(schema.reviewEmailSchedule)
      .where(eq(schema.reviewEmailSchedule.clinicId, clinicId)),
    db
      .select()
      .from(schema.linkingFailures)
      .where(eq(schema.linkingFailures.clinicId, clinicId)),
    db
      .select()
      .from(schema.pvsEventLog)
      .where(eq(schema.pvsEventLog.clinicId, clinicId)),
    db
      .select()
      .from(schema.pvsPatientMap)
      .where(eq(schema.pvsPatientMap.clinicId, clinicId)),
    db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.clinicId, clinicId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    clinic,
    users,
    requests,
    requestActivities: activities,
    assets,
    animationInstances,
    documents,
    campaignSnapshots,
    kpiDaily,
    goals,
    notifications,
    hwgChecks,
    platformCredentials,
    patients,
    patientFeedback,
    reviews,
    reviewEmailSchedule,
    linkingFailures,
    pvsEventLog,
    pvsPatientMap,
    auditLog,
  };
}

/**
 * Hard delete all clinic-scoped data. Order matters because some tables
 * have FKs without CASCADE. We keep the audit log entries — the regulator
 * wants proof of when the erasure happened. The caller is expected to
 * write ONE final audit row (entityKind=dsgvo_erasure) before invoking
 * this function.
 */
export async function eraseClinicData(clinicId: string): Promise<void> {
  // Wrapped in a single transaction so a mid-sequence failure rolls back
  // wholesale — a partial erasure must never coexist with a "claims erased"
  // audit row (pentest L13). Deletes run sequentially (one tx connection).
  await db.transaction(async (tx) => {
    // 1) dependents of requests
    const reqIds = (
      await tx
        .select({ id: schema.requests.id })
        .from(schema.requests)
        .where(eq(schema.requests.clinicId, clinicId))
    ).map((r) => r.id);

    if (reqIds.length) {
      await tx
        .delete(schema.requestActivities)
        .where(inArray(schema.requestActivities.requestId, reqIds));
    }

    // 2) clinic-scoped rows. Includes pvs_event_log, which has NO clinic FK
    //    and is therefore NOT removed by the final clinic delete's cascade —
    //    without this explicit delete its PHI payload survives Art.17 erasure
    //    indefinitely (pentest H11 / phi-erasure-pvs-event-log).
    await tx.delete(schema.requests).where(eq(schema.requests.clinicId, clinicId));
    await tx.delete(schema.assets).where(eq(schema.assets.clinicId, clinicId));
    await tx
      .delete(schema.animationInstances)
      .where(eq(schema.animationInstances.clinicId, clinicId));
    await tx.delete(schema.documents).where(eq(schema.documents.clinicId, clinicId));
    await tx
      .delete(schema.campaignSnapshots)
      .where(eq(schema.campaignSnapshots.clinicId, clinicId));
    await tx.delete(schema.kpiDaily).where(eq(schema.kpiDaily.clinicId, clinicId));
    await tx.delete(schema.goals).where(eq(schema.goals.clinicId, clinicId));
    await tx
      .delete(schema.notifications)
      .where(eq(schema.notifications.clinicId, clinicId));
    await tx.delete(schema.hwgChecks).where(eq(schema.hwgChecks.clinicId, clinicId));
    await tx
      .delete(schema.platformCredentials)
      .where(eq(schema.platformCredentials.clinicId, clinicId));
    await tx
      .delete(schema.pvsEventLog)
      .where(eq(schema.pvsEventLog.clinicId, clinicId));

    // 3) users + sessions via magic_links FK — delete magic_links first
    const userIds = (
      await tx
        .select({ id: schema.clinicUsers.id })
        .from(schema.clinicUsers)
        .where(eq(schema.clinicUsers.clinicId, clinicId))
    ).map((u) => u.id);

    if (userIds.length) {
      await tx
        .delete(schema.magicLinks)
        .where(inArray(schema.magicLinks.userId, userIds));
      await tx
        .delete(schema.sessions)
        .where(inArray(schema.sessions.userId, userIds));
    }
    await tx
      .delete(schema.clinicUsers)
      .where(eq(schema.clinicUsers.clinicId, clinicId));

    // 4) finally the clinic row itself. Remaining clinic-scoped PHI tables
    //    (patients, patient_feedback, reviews, review_email_schedule,
    //    pvs_patient_map, linking_failures) carry ON DELETE CASCADE to clinics
    //    and are removed here. auditLog.clinicId is intentionally nullable with
    //    no FK, so the audit trail survives.
    await tx.delete(schema.clinics).where(eq(schema.clinics.id, clinicId));
  });
}
