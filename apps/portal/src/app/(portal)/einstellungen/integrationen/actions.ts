"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { writeAudit } from "@/server/audit";
import { encryptString } from "@/lib/crypto";
import {
  issueAgentEnrollment,
  listOpenEnrollments,
} from "@/server/pvs-agent-enroll";
import {
  invalidateSignatureSecretCache,
  mintAndStorePvsSecret,
} from "@/server/clinic-signature";
import {
  manuallyResolveLinkingFailure,
  ignoreLinkingFailure,
} from "@/server/pvs-linking";
import { enqueuePvsLinkBackfill } from "@/server/jobs";

/**
 * Server actions for the integrations UI surfaces under
 * /einstellungen/integrationen/**.
 */

// ---------------------------------------------------------------
// GDT-Agent enrollment
// ---------------------------------------------------------------

export async function issueAgentEnrollmentAction(input: {
  expectedFingerprint?: string;
  /**
   * P1-3: operator must explicitly tick this when issuing a token for a
   * clinic that is already connected to a different PVS adapter. The
   * redemption path refuses the switch otherwise — see
   * vendor_switch_requires_confirmation in /api/pvs/agent-enroll.
   */
  allowVendorSwitch?: boolean;
}): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; error: string }> {
  const session = await requireSession();
  if (session.role !== "inhaber") {
    return { ok: false, error: "forbidden" };
  }
  const result = await issueAgentEnrollment({
    clinicId: session.clinicId,
    createdBy: session.userId,
    expectedFingerprint: input.expectedFingerprint,
    allowVendorSwitch: input.allowVendorSwitch ?? false,
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_agent_enroll_issue",
    entityKind: "pvs_agent_enrollment_tokens",
    entityId: result.enrollmentId,
    diff: {
      allowVendorSwitch: input.allowVendorSwitch ?? false,
    },
  });
  revalidatePath("/einstellungen/integrationen/setup/gdt-agent");
  return {
    ok: true,
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function listOpenAgentEnrollmentsAction() {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return [];
  }
  return await listOpenEnrollments(session.clinicId);
}

// ---------------------------------------------------------------
// n8n / generic PVS HMAC secret reveal
// ---------------------------------------------------------------

/**
 * Rotate (or mint, if absent) the per-clinic PVS HMAC secret. Returns the
 * plaintext ONCE so the inhaber can paste it into their n8n / generic
 * adapter config. Subsequent rotations invalidate any previously-deployed
 * adapter instances.
 */
export async function rotatePvsSecretAction(): Promise<
  { ok: true; secretHex: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (session.role !== "inhaber") {
    return { ok: false, error: "forbidden" };
  }
  // Wrap mint + pvs_link upsert in a single transaction so a transient
  // failure on the upsert can't strand a freshly-minted secret in
  // platform_credentials while the link row stays unchanged.
  const { secretHex } = await db.transaction(async (tx) => {
    const minted = await mintAndStorePvsSecret(
      session.clinicId,
      encryptString,
      tx as unknown as typeof db
    );
    // Ensure the pvs_link points at n8n_custom (if no other adapter is set).
    await tx
      .insert(schema.pvsLink)
      .values({
        clinicId: session.clinicId,
        pvsVendor: "n8n_custom",
        status: "connected",
      })
      .onConflictDoNothing({ target: schema.pvsLink.clinicId });
    return minted;
  });

  // Cache invalidation MUST happen after the tx commits, otherwise a
  // concurrent verify could repopulate the cache with the pre-commit (old)
  // secret. See mintAndStorePvsSecret JSDoc for the race description.
  invalidateSignatureSecretCache(session.clinicId, "pvs");

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_secret_rotated",
    entityKind: "platform_credentials",
    diff: { platform: "pvs" },
  });
  revalidatePath("/einstellungen/integrationen/setup/n8n");
  return { ok: true, secretHex };
}

// ---------------------------------------------------------------
// Linking failures
// ---------------------------------------------------------------

export async function resolveLinkingFailureAction(input: {
  failureId: string;
  pickedPatientId: string;
  method: "candidate_pick" | "manual_search" | "new_patient";
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return { ok: false, error: "forbidden" };
  }
  await manuallyResolveLinkingFailure({
    failureId: input.failureId,
    clinicId: session.clinicId,
    resolverUserId: session.userId,
    pickedPatientId: input.pickedPatientId,
    method: input.method,
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_linking_failure_resolved",
    entityKind: "linking_failures",
    entityId: input.failureId,
    diff: { method: input.method, pickedPatientId: input.pickedPatientId },
  });
  // Re-run derive for the resolved patient.
  // (Done lazily — backfill enqueues the right derive job.)
  const [failure] = await db
    .select({ pvsPatientId: schema.linkingFailures.pvsPatientId })
    .from(schema.linkingFailures)
    .where(
      and(
        eq(schema.linkingFailures.id, input.failureId),
        eq(schema.linkingFailures.clinicId, session.clinicId)
      )
    )
    .limit(1);
  if (failure) {
    await enqueuePvsLinkBackfill(session.clinicId, failure.pvsPatientId);
  }
  revalidatePath("/einstellungen/integrationen/links");
  return { ok: true };
}

export async function ignoreLinkingFailureAction(input: {
  failureId: string;
}): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return { ok: false };
  }
  await ignoreLinkingFailure(input.failureId, session.clinicId, session.userId);
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_linking_failure_ignored",
    entityKind: "linking_failures",
    entityId: input.failureId,
  });
  revalidatePath("/einstellungen/integrationen/links");
  return { ok: true };
}

// ---------------------------------------------------------------
// Treatment / location mapping
// ---------------------------------------------------------------

export async function mapTreatmentAction(input: {
  mappingId: string;
  portalTreatmentId: string | null;
  setStatus: "mapped" | "ignored" | "unmapped";
}): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return { ok: false };
  }
  await db
    .update(schema.pvsTreatmentMapping)
    .set({
      portalTreatmentId: input.portalTreatmentId,
      status: input.setStatus,
      mappedBy: session.userId,
      mappedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pvsTreatmentMapping.id, input.mappingId),
        eq(schema.pvsTreatmentMapping.clinicId, session.clinicId)
      )
    );
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_treatment_mapped",
    entityKind: "pvs_treatment_mapping",
    entityId: input.mappingId,
    diff: { portalTreatmentId: input.portalTreatmentId, status: input.setStatus },
  });
  revalidatePath("/einstellungen/integrationen/mapping/treatments");
  return { ok: true };
}

export async function mapLocationAction(input: {
  mappingId: string;
  portalLocationId: string | null;
  setStatus: "mapped" | "ignored" | "unmapped";
}): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return { ok: false };
  }
  await db
    .update(schema.pvsLocationMapping)
    .set({
      portalLocationId: input.portalLocationId,
      status: input.setStatus,
      mappedBy: session.userId,
      mappedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pvsLocationMapping.id, input.mappingId),
        eq(schema.pvsLocationMapping.clinicId, session.clinicId)
      )
    );
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_location_mapped",
    entityKind: "pvs_location_mapping",
    entityId: input.mappingId,
    diff: { portalLocationId: input.portalLocationId, status: input.setStatus },
  });
  revalidatePath("/einstellungen/integrationen/mapping/locations");
  return { ok: true };
}
