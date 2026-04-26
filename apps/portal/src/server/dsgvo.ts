import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * DSGVO-Werkzeuge (Art. 15 Auskunft / Art. 17 Löschung).
 *
 * Export: gibt ein JSON-Objekt zurück, das alle klinik-scopeten Tabellen
 * enthält. Kein Streaming nötig — die Datenmenge pro Klinik ist klein.
 *
 * Löschung (Erasure): hard delete aller klinik-bezogenen Zeilen in
 * abhängiger Reihenfolge, anschließend der Klinik selbst. Audit wird vom
 * Aufrufer geschrieben.
 *
 * Beide Funktionen gehören in admin-gated Server-Actions / API-Routen.
 * Kein RLS-Bypass nötig — `db` ist der Superuser-Client.
 */

export interface DsgvoExport {
  exportedAt: string;
  clinic: unknown;
  users: unknown[];
  upgradeRequests: unknown[];
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
      // Redact MFA secrets and backup-code hashes from the export — they
      // are cryptographic material, not personal data the user asked for.
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
      role: schema.clinicUsers.role,
      mfaEnrolled: schema.clinicUsers.mfaEnrolled,
      invitedAt: schema.clinicUsers.invitedAt,
      lastLoginAt: schema.clinicUsers.lastLoginAt,
      uiMode: schema.clinicUsers.uiMode,
      createdAt: schema.clinicUsers.createdAt,
      archivedAt: schema.clinicUsers.archivedAt,
    })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.clinicId, clinicId));

  const requests = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.clinicId, clinicId));

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
    upgradeRequests,
    assets,
    animationInstances,
    documents,
    campaignSnapshots,
    kpiDaily,
    goals,
    notifications,
    hwgChecks,
    platformCredentials,
    auditLog,
  ] = await Promise.all([
    db
      .select()
      .from(schema.upgradeRequests)
      .where(eq(schema.upgradeRequests.clinicId, clinicId)),
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
    db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.clinicId, clinicId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    clinic,
    users,
    upgradeRequests,
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
  // 1) dependents of requests
  const reqIds = (
    await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.clinicId, clinicId))
  ).map((r) => r.id);

  if (reqIds.length) {
    await db
      .delete(schema.requestActivities)
      .where(inArray(schema.requestActivities.requestId, reqIds));
  }

  // 2) clinic-scoped rows (no inter-dependencies between these)
  await Promise.all([
    db.delete(schema.requests).where(eq(schema.requests.clinicId, clinicId)),
    db
      .delete(schema.upgradeRequests)
      .where(eq(schema.upgradeRequests.clinicId, clinicId)),
    db.delete(schema.assets).where(eq(schema.assets.clinicId, clinicId)),
    db
      .delete(schema.animationInstances)
      .where(eq(schema.animationInstances.clinicId, clinicId)),
    db
      .delete(schema.documents)
      .where(eq(schema.documents.clinicId, clinicId)),
    db
      .delete(schema.campaignSnapshots)
      .where(eq(schema.campaignSnapshots.clinicId, clinicId)),
    db
      .delete(schema.kpiDaily)
      .where(eq(schema.kpiDaily.clinicId, clinicId)),
    db.delete(schema.goals).where(eq(schema.goals.clinicId, clinicId)),
    db
      .delete(schema.notifications)
      .where(eq(schema.notifications.clinicId, clinicId)),
    db.delete(schema.hwgChecks).where(eq(schema.hwgChecks.clinicId, clinicId)),
    db
      .delete(schema.platformCredentials)
      .where(eq(schema.platformCredentials.clinicId, clinicId)),
  ]);

  // 3) users + sessions via magic_links FK — delete magic_links first
  const userIds = (
    await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.clinicId, clinicId))
  ).map((u) => u.id);

  if (userIds.length) {
    await db
      .delete(schema.magicLinks)
      .where(inArray(schema.magicLinks.userId, userIds));
    await db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.userId, userIds));
  }
  await db
    .delete(schema.clinicUsers)
    .where(eq(schema.clinicUsers.clinicId, clinicId));

  // 4) finally the clinic row itself. auditLog.clinicId is intentionally
  // nullable and has no FK, so the audit trail survives.
  await db.delete(schema.clinics).where(eq(schema.clinics.id, clinicId));
}
