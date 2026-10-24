"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
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
import { flashMessageFromError } from "@/lib/flash";

/**
 * Server actions for the integrations UI surfaces under
 * /einstellungen/integrationen/**.
 *
 * B-19 / F-27: every client-supplied id is validated at runtime (uuid /
 * enum), and mapping targets are proven to belong to the session's Praxis
 * before a write. These actions run on the superuser `db` (no RLS), so the
 * WHERE clauses and these checks are the only tenancy guard. Invalid input
 * returns `{ ok: false, error }` with a German text (the UI keeps its state)
 * instead of a Postgres 500; unexpected failures are caught the same way (F-01).
 */

// German results for the UI (F-01): the setup pages show `error` as is.
const FORBIDDEN_TEXT = "Dafür fehlt Ihrer Rolle die Berechtigung.";
const INVALID_TEXT =
  "Das hat nicht geklappt. Bitte laden Sie die Seite neu und versuchen Sie es erneut.";
const NOT_RESOLVED_TEXT =
  "Diese Zuordnung ist schon erledigt oder nicht mehr möglich. Bitte laden Sie die Seite neu.";

const UuidSchema = z.string().uuid();
const MappingStatusSchema = z.enum(["mapped", "ignored", "unmapped"]);
const MappingInputSchema = z
  .object({
    mappingId: UuidSchema,
    targetId: UuidSchema.nullable(),
    setStatus: MappingStatusSchema,
  })
  // "mapped" needs a target; "ignored" / "unmapped" never keep one.
  .refine((v) => v.setStatus !== "mapped" || v.targetId !== null);

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
  try {
    if (!can(session.role, "settings.integrations")) {
      return { ok: false, error: FORBIDDEN_TEXT };
    }
    const parsedInput = z
      .object({
        expectedFingerprint: z.string().trim().max(200).optional(),
        allowVendorSwitch: z.boolean().optional(),
      })
      .safeParse(input ?? {});
    if (!parsedInput.success) {
      return { ok: false, error: INVALID_TEXT };
    }
    input = parsedInput.data;
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
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "integrations.agent_enroll") };
  }
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
  try {
    if (!can(session.role, "settings.integrations")) {
      return { ok: false, error: FORBIDDEN_TEXT };
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
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "integrations.pvs_secret") };
  }
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
  try {
    if (!can(session.role, "settings.integrations")) {
      return { ok: false, error: FORBIDDEN_TEXT };
    }
    const parsed = z
      .object({
        failureId: UuidSchema,
        pickedPatientId: UuidSchema,
        method: z.enum(["candidate_pick", "manual_search", "new_patient"]),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_TEXT };
    }
    input = parsed.data;
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
      .select({
        pvsPatientId: schema.linkingFailures.pvsPatientId,
        status: schema.linkingFailures.status,
        resolvedAt: schema.linkingFailures.resolvedAt,
      })
      .from(schema.linkingFailures)
      .where(
        and(
          eq(schema.linkingFailures.id, input.failureId),
          eq(schema.linkingFailures.clinicId, session.clinicId)
        )
      )
      .limit(1);
    // manuallyResolveLinkingFailure is a silent no-op for an unknown / closed
    // failure or a patient of another Praxis; report that instead of "ok".
    if (!failure || (failure.status === "open" && failure.resolvedAt === null)) {
      return { ok: false, error: NOT_RESOLVED_TEXT };
    }
    await enqueuePvsLinkBackfill(session.clinicId, failure.pvsPatientId);
    revalidatePath("/einstellungen/integrationen/links");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "integrations.link_resolve") };
  }
}

export async function ignoreLinkingFailureAction(input: {
  failureId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  try {
    if (!can(session.role, "settings.integrations")) {
      return { ok: false, error: FORBIDDEN_TEXT };
    }
    const failureId = UuidSchema.safeParse(input?.failureId);
    if (!failureId.success) return { ok: false, error: INVALID_TEXT };
    input = { failureId: failureId.data };
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
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "integrations.link_ignore") };
  }
}

// ---------------------------------------------------------------
// Treatment / location mapping
// ---------------------------------------------------------------

export async function mapTreatmentAction(input: {
  mappingId: string;
  portalTreatmentId: string | null;
  setStatus: "mapped" | "ignored" | "unmapped";
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  try {
    if (!can(session.role, "settings.integrations")) {
      return { ok: false, error: FORBIDDEN_TEXT };
    }
    const parsed = MappingInputSchema.safeParse({
      mappingId: input?.mappingId,
      targetId: input?.setStatus === "mapped" ? (input?.portalTreatmentId ?? null) : null,
      setStatus: input?.setStatus,
    });
    if (!parsed.success) return { ok: false, error: INVALID_TEXT };
    input = {
      mappingId: parsed.data.mappingId,
      portalTreatmentId: parsed.data.targetId,
      setStatus: parsed.data.setStatus,
    };
    // The target treatment must be an active treatment of THIS Praxis.
    if (input.portalTreatmentId) {
      const [target] = await db
        .select({ id: schema.treatments.id })
        .from(schema.treatments)
        .where(
          and(
            eq(schema.treatments.id, input.portalTreatmentId),
            eq(schema.treatments.clinicId, session.clinicId),
            isNull(schema.treatments.archivedAt)
          )
        )
        .limit(1);
      if (!target) return { ok: false, error: INVALID_TEXT };
    }
    const updated = await db
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
      )
      .returning({ id: schema.pvsTreatmentMapping.id });
    if (updated.length === 0) return { ok: false, error: INVALID_TEXT };
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
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "integrations.map_treatment") };
  }
}

export async function mapLocationAction(input: {
  mappingId: string;
  portalLocationId: string | null;
  setStatus: "mapped" | "ignored" | "unmapped";
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  try {
    if (!can(session.role, "settings.integrations")) {
      return { ok: false, error: FORBIDDEN_TEXT };
    }
    const parsed = MappingInputSchema.safeParse({
      mappingId: input?.mappingId,
      targetId: input?.setStatus === "mapped" ? (input?.portalLocationId ?? null) : null,
      setStatus: input?.setStatus,
    });
    if (!parsed.success) return { ok: false, error: INVALID_TEXT };
    input = {
      mappingId: parsed.data.mappingId,
      portalLocationId: parsed.data.targetId,
      setStatus: parsed.data.setStatus,
    };
    // The target location must be an active location of THIS Praxis.
    if (input.portalLocationId) {
      const [target] = await db
        .select({ id: schema.locations.id })
        .from(schema.locations)
        .where(
          and(
            eq(schema.locations.id, input.portalLocationId),
            eq(schema.locations.clinicId, session.clinicId),
            isNull(schema.locations.archivedAt)
          )
        )
        .limit(1);
      if (!target) return { ok: false, error: INVALID_TEXT };
    }
    const updated = await db
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
      )
      .returning({ id: schema.pvsLocationMapping.id });
    if (updated.length === 0) return { ok: false, error: INVALID_TEXT };
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
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "integrations.map_location") };
  }
}
