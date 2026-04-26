"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { issueMagicLink } from "@/auth/magic-link";
import { ROLES } from "@/lib/constants";
import { resetMfa } from "@/auth/totp";

const EmailSchema = z.string().email().max(200);

/**
 * Invite a new team member. Creates a clinic_users row in pending state
 * (mfaEnrolled=false), then issues an invite magic-link.
 */
export async function inviteTeamMemberAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) {
    throw new ForbiddenError("settings.team");
  }

  const input = z
    .object({
      email: EmailSchema,
      fullName: z.string().min(1).max(200),
      role: z.enum(ROLES),
    })
    .parse({
      email: formData.get("email"),
      fullName: formData.get("fullName"),
      role: formData.get("role"),
    });

  // Block inviting an existing active member.
  const [existing] = await db
    .select({ id: schema.clinicUsers.id, archivedAt: schema.clinicUsers.archivedAt })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.clinicId, session.clinicId),
        eq(schema.clinicUsers.email, input.email)
      )
    )
    .limit(1);

  let userId: string;
  if (existing) {
    if (!existing.archivedAt) {
      throw new Error("Diese E-Mail-Adresse ist bereits eingetragen.");
    }
    // Reactivate.
    await db
      .update(schema.clinicUsers)
      .set({
        archivedAt: null,
        role: input.role,
        fullName: input.fullName,
        invitedAt: new Date(),
      })
      .where(eq(schema.clinicUsers.id, existing.id));
    userId = existing.id;
  } else {
    const [row] = await db
      .insert(schema.clinicUsers)
      .values({
        clinicId: session.clinicId,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        invitedAt: new Date(),
      })
      .returning({ id: schema.clinicUsers.id });
    userId = row!.id;
  }

  await issueMagicLink({
    email: input.email,
    intent: "invite",
    userId,
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "invite",
    entityKind: "clinic_user",
    entityId: userId,
    diff: { email: input.email, role: input.role },
  });

  revalidatePath("/einstellungen");
}

/** Archive a team member (soft delete). */
export async function removeTeamMemberAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) {
    throw new ForbiddenError("settings.team");
  }
  const targetId = z.string().uuid().parse(formData.get("userId"));
  if (targetId === session.userId) {
    throw new Error("Sie können sich nicht selbst entfernen.");
  }

  await db
    .update(schema.clinicUsers)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(schema.clinicUsers.id, targetId),
        eq(schema.clinicUsers.clinicId, session.clinicId)
      )
    );

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "archive",
    entityKind: "clinic_user",
    entityId: targetId,
    diff: {},
  });

  revalidatePath("/einstellungen");
}

/** Reset 2FA for a team member — they'll re-enroll on next login. */
export async function resetMemberMfaAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) {
    throw new ForbiddenError("settings.team");
  }
  const targetId = z.string().uuid().parse(formData.get("userId"));

  // Confirm target is in same clinic.
  const [member] = await db
    .select({ id: schema.clinicUsers.id })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.id, targetId),
        eq(schema.clinicUsers.clinicId, session.clinicId),
        isNull(schema.clinicUsers.archivedAt)
      )
    )
    .limit(1);
  if (!member) throw new Error("Teammitglied nicht gefunden.");

  await resetMfa(targetId);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "reset_mfa",
    entityKind: "clinic_user",
    entityId: targetId,
    diff: {},
  });

  revalidatePath("/einstellungen");
}

/** Update the logged-in user's own profile. */
export async function updateOwnProfileAction(formData: FormData) {
  const session = await requireSession();
  const input = z
    .object({
      fullName: z.string().min(1).max(200),
    })
    .parse({
      fullName: formData.get("fullName"),
    });

  await db
    .update(schema.clinicUsers)
    .set({ fullName: input.fullName })
    .where(eq(schema.clinicUsers.id, session.userId));

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "clinic_user",
    entityId: session.userId,
    diff: { fullName: input.fullName },
  });

  revalidatePath("/einstellungen");
}

/** Update clinic-level settings (logo URL, HWG contact). Inhaber only. */
export async function updateClinicSettingsAction(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "inhaber") {
    throw new ForbiddenError("settings.team");
  }
  const input = z
    .object({
      displayName: z.string().min(1).max(200),
      hwgContactName: z.string().max(200).optional(),
      hwgContactEmail: EmailSchema.optional().or(z.literal("")),
      defaultDoctorEmail: EmailSchema.optional().or(z.literal("")),
    })
    .parse({
      displayName: formData.get("displayName"),
      hwgContactName: formData.get("hwgContactName") ?? undefined,
      hwgContactEmail: formData.get("hwgContactEmail") ?? undefined,
      defaultDoctorEmail: formData.get("defaultDoctorEmail") ?? undefined,
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.clinics)
      .set({
        displayName: input.displayName,
        hwgContactName: input.hwgContactName || null,
        hwgContactEmail: input.hwgContactEmail || null,
        defaultDoctorEmail: input.defaultDoctorEmail || null,
      })
      .where(eq(schema.clinics.id, session.clinicId));
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "clinic",
    entityId: session.clinicId,
    diff: {
      displayName: input.displayName,
      hwgContactName: input.hwgContactName || null,
      hwgContactEmail: input.hwgContactEmail || null,
    },
  });

  revalidatePath("/einstellungen");
}

/** Disconnect a platform integration — deletes the credential row. */
export async function disconnectIntegrationAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    throw new ForbiddenError("settings.integrations");
  }
  const platform = z.enum(["meta", "google"]).parse(formData.get("platform"));

  await db
    .delete(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, session.clinicId),
        eq(schema.platformCredentials.platform, platform)
      )
    );

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "disconnect",
    entityKind: "platform_credentials",
    diff: { platform },
  });

  revalidatePath("/einstellungen");
  revalidatePath("/werbebudget");
}

// ============================================================
// Detail-mode CRUD: treatments, locations, reviews
// ============================================================

const SlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "Nur Kleinbuchstaben, Zahlen, Bindestriche.");

export async function createTreatmentAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
  const input = z
    .object({
      name: z.string().min(1).max(120),
      slug: SlugSchema,
      keywords: z.string().max(500).optional(),
      defaultRecallMonths: z.coerce.number().int().min(0).max(60).optional(),
    })
    .parse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      keywords: formData.get("keywords") ?? undefined,
      defaultRecallMonths: formData.get("defaultRecallMonths") ?? undefined,
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx.insert(schema.treatments).values({
      clinicId: session.clinicId,
      name: input.name,
      slug: input.slug,
      keywords: input.keywords ?? null,
      defaultRecallMonths: input.defaultRecallMonths ?? null,
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "treatment",
    diff: { ...input },
  });
  revalidatePath("/einstellungen");
}

export async function archiveTreatmentAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
  const id = z.string().uuid().parse(formData.get("treatmentId"));
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.treatments)
      .set({ archivedAt: new Date(), isActive: false })
      .where(
        and(
          eq(schema.treatments.id, id),
          eq(schema.treatments.clinicId, session.clinicId)
        )
      );
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entityKind: "treatment",
    entityId: id,
  });
  revalidatePath("/einstellungen");
}

export async function createLocationAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
  const input = z
    .object({
      name: z.string().min(1).max(200),
      address: z.string().max(500).optional(),
    })
    .parse({
      name: formData.get("name"),
      address: formData.get("address") ?? undefined,
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx.insert(schema.locations).values({
      clinicId: session.clinicId,
      name: input.name,
      address: input.address ?? null,
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "location",
    diff: { ...input },
  });
  revalidatePath("/einstellungen");
}

export async function archiveLocationAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
  const id = z.string().uuid().parse(formData.get("locationId"));
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.locations)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.locations.id, id),
          eq(schema.locations.clinicId, session.clinicId)
        )
      );
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entityKind: "location",
    entityId: id,
  });
  revalidatePath("/einstellungen");
}

export async function logReviewSnapshotAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
  const input = z
    .object({
      platform: z.enum(["google", "jameda", "trustpilot", "manual"]),
      rating: z.coerce.number().min(0).max(5),
      totalCount: z.coerce.number().int().min(0).max(1_000_000),
      notes: z.string().max(500).optional(),
    })
    .parse({
      platform: formData.get("platform"),
      rating: formData.get("rating"),
      totalCount: formData.get("totalCount"),
      notes: formData.get("notes") ?? undefined,
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx.insert(schema.reviews).values({
      clinicId: session.clinicId,
      platform: input.platform,
      rating: input.rating.toFixed(1),
      totalCount: input.totalCount,
      notes: input.notes ?? null,
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "review",
    diff: { ...input },
  });
  revalidatePath("/einstellungen");
  revalidatePath("/dashboard");
  revalidatePath("/auswertung");
}
