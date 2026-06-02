"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { issueMagicLink } from "@/auth/magic-link";
import { ROLES } from "@/lib/constants";
import { encryptString } from "@/lib/crypto";
import { flashSuccess, flashError, flashMessageFromError } from "@/lib/flash";
import { invalidateSignatureSecretCache } from "@/server/clinic-signature";

const EmailSchema = z.string().email().max(200);

/**
 * Invite a new team member. Creates a clinic_users row in pending state,
 * then issues an invite magic-link.
 */
export async function inviteTeamMemberAction(formData: FormData) {
  try {
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

    await flashSuccess("Einladung verschickt", `${input.fullName} (${input.email})`);
  } catch (err) {
    await flashError("Einladung fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

/** Archive a team member (soft delete). */
export async function removeTeamMemberAction(formData: FormData) {
  try {
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

    await flashSuccess("Teammitglied entfernt");
  } catch (err) {
    await flashError("Entfernen fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

/** Update the logged-in user's own profile. */
export async function updateOwnProfileAction(formData: FormData) {
  try {
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

    await flashSuccess("Profil aktualisiert", input.fullName);
  } catch (err) {
    await flashError("Profil konnte nicht aktualisiert werden", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

/** Update clinic-level settings (logo URL, HWG contact). Inhaber only. */
export async function updateClinicSettingsAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
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

    await flashSuccess("Praxis-Angaben gespeichert");
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", flashMessageFromError(err));
  } finally {
    if (clinicIdForRevalidate) {
      revalidateTag(`clinic:${clinicIdForRevalidate}`);
    }
    revalidatePath("/einstellungen");
  }
}

/** Disconnect a platform integration — deletes the credential row. */
export async function disconnectIntegrationAction(formData: FormData) {
  try {
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

    await flashSuccess(
      "Integration getrennt",
      platform === "meta" ? "Meta Ads" : "Google Ads"
    );
  } catch (err) {
    await flashError("Trennen fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
    revalidatePath("/werbebudget");
  }
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
  try {
    const session = await requireSession();
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
    const input = z
      .object({
        name: z.string().min(1).max(120),
        slug: SlugSchema,
        keywords: z.string().max(500).optional(),
      })
      .parse({
        name: formData.get("name"),
        slug: formData.get("slug"),
        keywords: formData.get("keywords") ?? undefined,
      });

    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx.insert(schema.treatments).values({
        clinicId: session.clinicId,
        name: input.name,
        slug: input.slug,
        keywords: input.keywords ?? null,
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
    await flashSuccess("Behandlung angelegt", input.name);
  } catch (err) {
    await flashError("Behandlung konnte nicht angelegt werden", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

export async function archiveTreatmentAction(formData: FormData) {
  try {
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
    await flashSuccess("Behandlung archiviert");
  } catch (err) {
    await flashError("Archivieren fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

export async function createLocationAction(formData: FormData) {
  try {
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
    await flashSuccess("Standort angelegt", input.name);
  } catch (err) {
    await flashError("Standort konnte nicht angelegt werden", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

export async function archiveLocationAction(formData: FormData) {
  try {
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
    await flashSuccess("Standort archiviert");
  } catch (err) {
    await flashError("Archivieren fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath("/einstellungen");
  }
}

// ============================================================
// EINS Stimme — Bewertungen & Reputation settings
// ============================================================

/** Cookie that flashes a freshly-rotated HMAC secret to the next page render. */
const INTAKE_SECRET_FLASH_COOKIE = "eins_intake_secret_flash";

const ReviewUrlSchema = z
  .string()
  .url("Bitte eine vollständige URL angeben (https://…).")
  .max(500);

/** Google Place IDs start with a known prefix and are otherwise opaque tokens. */
const GooglePlaceIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[A-Za-z0-9_\-:]+$/,
    "Place-ID darf nur Buchstaben, Zahlen sowie - und _ enthalten."
  );

export async function updateReviewSettingsAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
    if (!can(session.role, "settings.team")) {
      throw new ForbiddenError("settings.team");
    }
    const input = z
      .object({
        reviewRequestEnabled: z.preprocess(
          (v) => v === "on" || v === "true" || v === true,
          z.boolean()
        ),
        googleReviewUrl: ReviewUrlSchema.optional().or(z.literal("")),
        jamedaReviewUrl: ReviewUrlSchema.optional().or(z.literal("")),
        reviewLandingOrigin: ReviewUrlSchema.optional().or(z.literal("")),
        reviewInboxEmail: z
          .string()
          .email("Ungültige E-Mail-Adresse.")
          .max(200)
          .optional()
          .or(z.literal("")),
        reviewRequestDelayDays: z.coerce.number().int().min(0).max(30),
        googlePlaceId: GooglePlaceIdSchema.optional().or(z.literal("")),
        jamedaProfileUrl: ReviewUrlSchema.optional().or(z.literal("")),
      })
      .parse({
        reviewRequestEnabled: formData.get("reviewRequestEnabled") ?? "false",
        googleReviewUrl: formData.get("googleReviewUrl") ?? undefined,
        jamedaReviewUrl: formData.get("jamedaReviewUrl") ?? undefined,
        reviewLandingOrigin: formData.get("reviewLandingOrigin") ?? undefined,
        reviewInboxEmail: formData.get("reviewInboxEmail") ?? undefined,
        reviewRequestDelayDays:
          formData.get("reviewRequestDelayDays") ?? 3,
        googlePlaceId: formData.get("googlePlaceId") ?? undefined,
        jamedaProfileUrl: formData.get("jamedaProfileUrl") ?? undefined,
      });

    // Refuse to enable the program without at least one review URL —
    // otherwise the landing page has nowhere for satisfied patients to go.
    if (
      input.reviewRequestEnabled &&
      !input.googleReviewUrl &&
      !input.jamedaReviewUrl
    ) {
      throw new Error(
        "Bitte hinterlegen Sie eine Google- oder Jameda-URL, bevor Sie die Bewertungs-Anfragen aktivieren."
      );
    }

    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .update(schema.clinics)
        .set({
          reviewRequestEnabled: input.reviewRequestEnabled,
          googleReviewUrl: input.googleReviewUrl || null,
          jamedaReviewUrl: input.jamedaReviewUrl || null,
          reviewLandingOrigin: input.reviewLandingOrigin || null,
          reviewInboxEmail: input.reviewInboxEmail || null,
          reviewRequestDelayDays: input.reviewRequestDelayDays,
          googlePlaceId: input.googlePlaceId || null,
          jamedaProfileUrl: input.jamedaProfileUrl || null,
        })
        .where(eq(schema.clinics.id, session.clinicId));
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "clinic_review_settings",
      diff: {
        reviewRequestEnabled: input.reviewRequestEnabled,
        hasGoogleUrl: Boolean(input.googleReviewUrl),
        hasJamedaUrl: Boolean(input.jamedaReviewUrl),
        hasGooglePlaceId: Boolean(input.googlePlaceId),
        hasJamedaProfileUrl: Boolean(input.jamedaProfileUrl),
        delayDays: input.reviewRequestDelayDays,
      },
    });

    await flashSuccess("Bewertungs-Einstellungen gespeichert");
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", flashMessageFromError(err));
  } finally {
    if (clinicIdForRevalidate) {
      revalidateTag(`clinic:${clinicIdForRevalidate}`);
    }
    revalidatePath("/einstellungen");
  }
}

/**
 * Manually trigger the three review syncs for this clinic. Runs inline so
 * the inhaber sees the updated tile on the next render (and gets per-
 * platform errors flashed back if anything failed).
 */
export async function syncReviewsNowAction() {
  const session = await requireSession();
  if (!can(session.role, "reviews.manage")) {
    throw new ForbiddenError("reviews.manage");
  }

  // Lazy import keeps the worker dependency graph out of the bundle path
  // until someone actually clicks the button.
  const { syncAllReviewsForClinic } = await import("@/server/review-sync");
  const outcomes = await syncAllReviewsForClinic(session.clinicId);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "sync",
    entityKind: "reviews",
    diff: { outcomes },
  });

  // Flash a short summary to the next render so the user knows what happened.
  const jar = await cookies();
  jar.set(REVIEW_SYNC_FLASH_COOKIE, JSON.stringify(outcomes), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30,
    path: "/einstellungen",
  });

  revalidatePath("/einstellungen");
  revalidatePath("/bewertungen");
  revalidatePath("/dashboard");
}

const REVIEW_SYNC_FLASH_COOKIE = "eins_review_sync_flash";

/**
 * Read + clear the flashed sync outcome. Returns null if no flash present
 * or the cookie payload is unreadable.
 */
export async function consumeReviewSyncFlash(): Promise<
  Array<{ platform: "google" | "jameda"; ok: boolean; error?: string }> | null
> {
  const jar = await cookies();
  const c = jar.get(REVIEW_SYNC_FLASH_COOKIE);
  if (!c) return null;
  jar.delete(REVIEW_SYNC_FLASH_COOKIE);
  try {
    return JSON.parse(c.value);
  } catch {
    return null;
  }
}

/**
 * Rotate the per-clinic HMAC secret used by both /api/leads/intake and
 * /api/patients/events. Encrypts the new secret server-side; flashes the
 * plaintext to the redirected page via a short-lived cookie. The plaintext
 * is shown ONCE — admin must copy it to Make.com immediately.
 */
export async function rotateIntakeSecretAction() {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    throw new ForbiddenError("settings.integrations");
  }

  const plaintext = randomBytes(32).toString("hex");
  const ciphertext = encryptString(plaintext);

  await db
    .insert(schema.platformCredentials)
    .values({
      clinicId: session.clinicId,
      platform: "intake",
      accessTokenEnc: ciphertext,
    })
    .onConflictDoUpdate({
      target: [
        schema.platformCredentials.clinicId,
        schema.platformCredentials.platform,
      ],
      set: { accessTokenEnc: ciphertext },
    });

  // Drop the cached old secret so the next /api/leads/intake or
  // /api/patients/events verification uses the freshly rotated value.
  invalidateSignatureSecretCache(session.clinicId, "intake");

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "rotate",
    entityKind: "intake_secret",
    diff: {},
  });

  // Flash the plaintext to the next render. 5-minute TTL.
  const jar = await cookies();
  jar.set(INTAKE_SECRET_FLASH_COOKIE, plaintext, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 5,
    path: "/einstellungen",
  });

  revalidatePath("/einstellungen");
}

/** Read + clear the flashed plaintext. Returns null if no flash present. */
export async function consumeIntakeSecretFlash(): Promise<string | null> {
  const jar = await cookies();
  const c = jar.get(INTAKE_SECRET_FLASH_COOKIE);
  if (!c) return null;
  jar.delete(INTAKE_SECRET_FLASH_COOKIE);
  return c.value;
}

// ============================================================
// Closed-loop ads-conversion config (Meta CAPI + Google Ads OCI)
// ============================================================

/**
 * Meta Pixel IDs are numeric, usually 15 digits but sometimes 16-17 on
 * older accounts; we permit 10-20 to be safe and let Meta reject the
 * actual value on the next CAPI call.
 */
const MetaPixelIdSchema = z
  .string()
  .regex(/^\d{10,20}$/, "Pixel-ID muss 10–20 Ziffern haben.");

/** Google Ads customer id; accepts `123-456-7890` or `1234567890`. */
const GoogleAdsCustomerIdSchema = z
  .string()
  .regex(
    /^[0-9]{3}-?[0-9]{3}-?[0-9]{4}$/,
    "Customer-ID hat das Format 123-456-7890."
  );

/**
 * Conversion-action resource name from Google Ads, e.g.
 * `customers/1234567890/conversionActions/9876543210`.
 */
const GoogleAdsConversionActionSchema = z
  .string()
  .regex(
    /^customers\/[0-9]+\/conversionActions\/[0-9]+$/,
    "Bitte vollständigen Resource-Name eingeben (customers/…/conversionActions/…)."
  );

const OptionalMccSchema = z
  .string()
  .regex(/^[0-9]{3}-?[0-9]{3}-?[0-9]{4}$/, "MCC-ID hat das Format 123-456-7890.")
  .optional()
  .or(z.literal(""));

export async function updateAdsConversionConfigAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
    if (!can(session.role, "settings.integrations")) {
      throw new ForbiddenError("settings.integrations");
    }

    const input = z
      .object({
        metaPixelId: MetaPixelIdSchema.optional().or(z.literal("")),
        googleAdsCustomerId: GoogleAdsCustomerIdSchema.optional().or(
          z.literal("")
        ),
        googleAdsConversionAction:
          GoogleAdsConversionActionSchema.optional().or(z.literal("")),
        googleAdsLoginCustomerId: OptionalMccSchema,
      })
      .parse({
        metaPixelId: formData.get("metaPixelId") ?? undefined,
        googleAdsCustomerId: formData.get("googleAdsCustomerId") ?? undefined,
        googleAdsConversionAction:
          formData.get("googleAdsConversionAction") ?? undefined,
        googleAdsLoginCustomerId:
          formData.get("googleAdsLoginCustomerId") ?? undefined,
      });

    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .update(schema.clinics)
        .set({
          metaPixelId: input.metaPixelId || null,
          googleAdsCustomerId: input.googleAdsCustomerId || null,
          googleAdsConversionAction: input.googleAdsConversionAction || null,
          googleAdsLoginCustomerId: input.googleAdsLoginCustomerId || null,
        })
        .where(eq(schema.clinics.id, session.clinicId));
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "clinic_ads_conversion_config",
      diff: {
        hasMetaPixelId: Boolean(input.metaPixelId),
        hasGoogleAdsCustomerId: Boolean(input.googleAdsCustomerId),
        hasGoogleAdsConversionAction: Boolean(input.googleAdsConversionAction),
        hasGoogleAdsLoginCustomerIdOverride: Boolean(
          input.googleAdsLoginCustomerId
        ),
      },
    });

    await flashSuccess("Conversion-Einstellungen gespeichert");
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", flashMessageFromError(err));
  } finally {
    if (clinicIdForRevalidate) {
      revalidateTag(`clinic:${clinicIdForRevalidate}`);
    }
    revalidatePath("/einstellungen/integrationen/ads-conversion");
    revalidatePath("/einstellungen/integrationen");
  }
}

// Manual review-snapshot entry was removed: the portal listens to Google /
// Jameda via syncReviewsNowAction and the background sync worker. Reviews
// must never be written by the user — the platforms are the only source of
// truth.
