"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { issueMagicLink, type MagicLinkIssueResult } from "@/auth/magic-link";
import { revokeAllSessionsForUser } from "@/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { ROLES } from "@/lib/constants";
import { encryptString } from "@/lib/crypto";
import { flashSuccess, flashError } from "@/lib/flash";
import {
  parseSettingsInput,
  settingsErrorMessage,
  SettingsUserError,
} from "./_errors";
import { keywordsWithName, slugifyTreatmentName, uniqueSlug } from "./_slug";
import { invalidateSignatureSecretCache } from "@/server/clinic-signature";
import { env } from "@/lib/env";
import { releaseDisconnectedMetaPage } from "@/server/meta-pages";
import {
  isAllowedGoogleReviewUrl,
  isAllowedJamedaUrl,
  normalizeAllowedLandingOrigin,
} from "@/lib/review-url-allowlist";

const EmailSchema = z.string().email().max(200);

const INVITE_RESEND_LIMIT = { limit: 3, windowSeconds: 60 * 60 } as const;

async function clinicDisplayName(clinicId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ displayName: schema.clinics.displayName })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  return row?.displayName ?? undefined;
}

/**
 * Tell the Inhaber honestly whether the invitation mail went out (B-3).
 * The account row exists either way; "Einladung erneut senden" in the team
 * list retries.
 */
async function flashInviteOutcome(
  result: MagicLinkIssueResult,
  who: string
): Promise<void> {
  if (result.status === "sent" || result.status === "queued") {
    await flashSuccess("Einladung verschickt", `${who}. Der Link gilt 7 Tage.`);
    return;
  }
  if (result.status === "skipped" && result.reason === "suppressed") {
    await flashError(
      "Einladung nicht zugestellt",
      "Diese Adresse hat frühere E-Mails von uns abgewiesen. Bitte prüfen Sie die Schreibweise oder nennen Sie eine andere Adresse."
    );
    return;
  }
  await flashError(
    "Einladung nicht zugestellt",
    "Der Zugang ist angelegt, aber die E-Mail ging nicht raus. Bitte nutzen Sie in ein paar Minuten „Einladung erneut senden“."
  );
}

/**
 * Invite a new team member. Creates a clinic_users row in pending state,
 * then issues an invite magic-link (7 days valid).
 */
export async function inviteTeamMemberAction(formData: FormData) {
  try {
    const session = await requireSession();
    if (!can(session.role, "settings.team")) {
      throw new ForbiddenError("settings.team");
    }

    const input = parseSettingsInput(
      z.object({
        email: EmailSchema.transform((v) => v.trim().toLowerCase()),
        fullName: z.string().trim().min(1).max(200),
        role: z.enum(ROLES),
      }),
      {
        email: formData.get("email"),
        fullName: formData.get("fullName"),
        role: formData.get("role"),
      }
    );

    // Role ceiling: only an Inhaber may grant the Inhaber role. Without this
    // any settings.team holder could mint a second owner account
    // (pentest authn-05-massassign).
    if (input.role === "inhaber" && session.role !== "inhaber") {
      throw new ForbiddenError("settings.team");
    }

    // B-7: an address that already has an active access in ANOTHER Praxis is
    // refused. Login resolves an address to one account (oldest membership);
    // a second membership would either never be reachable or, the other way
    // round, let a foreign Praxis capture where a person lands.
    const [elsewhere] = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
      .where(
        and(
          eq(schema.clinicUsers.email, input.email),
          ne(schema.clinicUsers.clinicId, session.clinicId),
          isNull(schema.clinicUsers.archivedAt),
          isNull(schema.clinics.archivedAt)
        )
      )
      .limit(1);
    if (elsewhere) {
      throw new SettingsUserError(
        "Diese E-Mail-Adresse hat bereits einen Zugang bei einer anderen Praxis. Bitte nutzen Sie eine andere Adresse oder melden Sie sich bei EINS."
      );
    }

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
        throw new SettingsUserError(
          "Diese E-Mail-Adresse ist bereits eingetragen. Ist die Einladung noch offen, nutzen Sie „Einladung erneut senden“ in der Teamliste."
        );
      }
      // Reactivate. The old passwordHash is dropped so a re-activated
      // account cannot log in with its stale pre-archive credential — the
      // member sets a fresh password via the invite link.
      await db
        .update(schema.clinicUsers)
        .set({
          archivedAt: null,
          role: input.role,
          fullName: input.fullName,
          invitedAt: new Date(),
          passwordHash: null,
        })
        .where(eq(schema.clinicUsers.id, existing.id));
      userId = existing.id;
      // B-11: sessions from before the removal must not come back to life.
      await revokeAllSessionsForUser(existing.id);
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

    const delivery = await issueMagicLink({
      email: input.email,
      intent: "invite",
      userId,
      clinicName: await clinicDisplayName(session.clinicId),
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "invite",
      entityKind: "clinic_user",
      entityId: userId,
      diff: { email: input.email, role: input.role, delivery: delivery.status },
    });

    await flashInviteOutcome(delivery, `${input.fullName} (${input.email})`);
  } catch (err) {
    await flashError("Einladung fehlgeschlagen", settingsErrorMessage(err, "settings.invite"));
  } finally {
    revalidatePath("/einstellungen");
  }
}

/**
 * "Einladung erneut senden" (B-3 / F-21): new 7-day link for a member who
 * has not set up the access yet. Max 3 per member and hour.
 */
export async function resendInviteAction(formData: FormData) {
  try {
    const session = await requireSession();
    if (!can(session.role, "settings.team")) {
      throw new ForbiddenError("settings.team");
    }
    const targetId = parseSettingsInput(z.string().uuid(), formData.get("userId"));
    const [target] = await db
      .select({
        id: schema.clinicUsers.id,
        email: schema.clinicUsers.email,
        fullName: schema.clinicUsers.fullName,
        lastLoginAt: schema.clinicUsers.lastLoginAt,
        passwordSetAt: schema.clinicUsers.passwordSetAt,
      })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.id, targetId),
          eq(schema.clinicUsers.clinicId, session.clinicId),
          isNull(schema.clinicUsers.archivedAt)
        )
      )
      .limit(1);
    if (!target) {
      throw new SettingsUserError("Dieses Teammitglied wurde nicht gefunden.");
    }
    if (target.lastLoginAt || target.passwordSetAt) {
      throw new SettingsUserError(
        "Diese Person hat ihren Zugang schon eingerichtet. Bei einem vergessenen Passwort hilft „Passwort vergessen“ auf der Anmeldeseite."
      );
    }
    const rl = await rateLimit("invite-resend:user", target.id, INVITE_RESEND_LIMIT);
    if (!rl.ok) {
      throw new SettingsUserError(
        "Die Einladung wurde gerade mehrfach verschickt. Bitte warten Sie eine Stunde."
      );
    }

    await db
      .update(schema.clinicUsers)
      .set({ invitedAt: new Date() })
      .where(eq(schema.clinicUsers.id, target.id));

    const delivery = await issueMagicLink({
      email: target.email,
      intent: "invite",
      userId: target.id,
      clinicName: await clinicDisplayName(session.clinicId),
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "invite",
      entityKind: "clinic_user",
      entityId: target.id,
      diff: { resend: true, delivery: delivery.status },
    });

    await flashInviteOutcome(delivery, target.fullName ?? target.email);
  } catch (err) {
    await flashError("Erneut senden fehlgeschlagen", settingsErrorMessage(err, "settings.invite_resend"));
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
    const targetId = parseSettingsInput(z.string().uuid(), formData.get("userId"));
    if (targetId === session.userId) {
      throw new SettingsUserError("Sie können sich nicht selbst entfernen.");
    }

    // Last-Inhaber guard: archiving the final active Inhaber would leave the
    // Praxis without anyone who can manage the team (lockout).
    const [target] = await db
      .select({ role: schema.clinicUsers.role })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.id, targetId),
          eq(schema.clinicUsers.clinicId, session.clinicId)
        )
      )
      .limit(1);
    if (!target) {
      throw new SettingsUserError("Dieses Teammitglied wurde nicht gefunden.");
    }
    if (target.role === "inhaber") {
      const activeInhaber = await db
        .select({ id: schema.clinicUsers.id })
        .from(schema.clinicUsers)
        .where(
          and(
            eq(schema.clinicUsers.clinicId, session.clinicId),
            eq(schema.clinicUsers.role, "inhaber"),
            isNull(schema.clinicUsers.archivedAt)
          )
        );
      if (activeInhaber.length <= 1) {
        throw new Error(
          "Der letzte aktive Inhaber-Zugang kann nicht entfernt werden."
        );
      }
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
    // B-11: end every session of the removed member right away (target is
    // verified to belong to this Praxis above).
    await revokeAllSessionsForUser(targetId);

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
    await flashError("Entfernen fehlgeschlagen", settingsErrorMessage(err, "settings.remove_member"));
  } finally {
    revalidatePath("/einstellungen");
  }
}

/** Update the logged-in user's own profile. */
export async function updateOwnProfileAction(formData: FormData) {
  try {
    const session = await requireSession();
    const input = parseSettingsInput(
      z.object({
        fullName: z.string().trim().min(1).max(200),
      }),
      {
        fullName: formData.get("fullName"),
      }
    );

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
    await flashError("Profil konnte nicht aktualisiert werden", settingsErrorMessage(err, "settings.profile"));
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
    if (!can(session.role, "settings.team")) {
      throw new ForbiddenError("settings.team");
    }
    const input = parseSettingsInput(
      z.object({
        displayName: z.string().min(1).max(200),
        hwgContactName: z.string().max(200).optional(),
        hwgContactEmail: EmailSchema.optional().or(z.literal("")),
        defaultDoctorEmail: EmailSchema.optional().or(z.literal("")),
      }),
      {
        displayName: formData.get("displayName"),
        hwgContactName: formData.get("hwgContactName") ?? undefined,
        hwgContactEmail: formData.get("hwgContactEmail") ?? undefined,
        defaultDoctorEmail: formData.get("defaultDoctorEmail") ?? undefined,
      }
    );

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
    await flashError("Speichern fehlgeschlagen", settingsErrorMessage(err, "settings.clinic"));
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
    const platform = parseSettingsInput(z.enum(["meta", "google"]), formData.get("platform"));

    const removed = await db
      .delete(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.clinicId, session.clinicId),
          eq(schema.platformCredentials.platform, platform)
        )
      )
      .returning({
        pageId: schema.platformCredentials.metaPageId,
        pageTokenEnc: schema.platformCredentials.metaPageAccessTokenEnc,
      });

    // E6b: a page no Praxis holds any more stops sending leadgen events.
    // After the response, best effort (failures are logged, never shown).
    if (platform === "meta") {
      const clinicId = session.clinicId;
      for (const row of removed) {
        after(() => releaseDisconnectedMetaPage(clinicId, row.pageId, row.pageTokenEnc));
      }
    }

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
    await flashError("Trennen fehlgeschlagen", settingsErrorMessage(err, "settings.disconnect"));
  } finally {
    revalidatePath("/einstellungen");
    revalidatePath("/werbebudget");
  }
}

// ============================================================
// Detail-mode CRUD: treatments, locations, reviews
// ============================================================

/**
 * F-20: the Praxis only enters a name (and optional Stichwörter). The slug is
 * derived from the name (umlauts spelled out, unique per Praxis with a
 * counter), and the name always counts as a keyword so the new treatment
 * matches Anfragen right away.
 */
export async function createTreatmentAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
    const input = parseSettingsInput(
      z.object({
        name: z.string().trim().min(1).max(120),
        keywords: z.string().max(500).optional(),
      }),
      {
        name: formData.get("name"),
        keywords: formData.get("keywords") ?? undefined,
      }
    );
    const keywords = keywordsWithName(input.name, input.keywords);

    const slug = await withClinicContext(session.clinicId, session.userId, async (tx) => {
      const taken = await tx
        .select({ slug: schema.treatments.slug })
        .from(schema.treatments)
        .where(eq(schema.treatments.clinicId, session.clinicId));
      const next = uniqueSlug(
        slugifyTreatmentName(input.name),
        taken.map((r) => r.slug)
      );
      await tx.insert(schema.treatments).values({
        clinicId: session.clinicId,
        name: input.name,
        slug: next,
        keywords,
      });
      return next;
    });
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "create",
      entityKind: "treatment",
      diff: { name: input.name, slug, keywords },
    });
    await flashSuccess("Behandlung angelegt", input.name);
  } catch (err) {
    await flashError("Behandlung konnte nicht angelegt werden", settingsErrorMessage(err, "settings.treatment_create"));
  } finally {
    // F-10: treatment/location lists are cached under kpi:<clinicId>.
    if (clinicIdForRevalidate) revalidateTag(`kpi:${clinicIdForRevalidate}`);
    revalidatePath("/einstellungen");
  }
}

export async function archiveTreatmentAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
    const id = parseSettingsInput(z.string().uuid(), formData.get("treatmentId"));
    const archived = await withClinicContext(session.clinicId, session.userId, async (tx) =>
      tx
        .update(schema.treatments)
        .set({ archivedAt: new Date(), isActive: false })
        .where(
          and(
            eq(schema.treatments.id, id),
            eq(schema.treatments.clinicId, session.clinicId)
          )
        )
        .returning({ id: schema.treatments.id })
    );
    // V3 Neben 1: an id of another Praxis (or a stale one) matches no row.
    // No success message and no audit row for something that did not happen.
    if (archived.length === 0) {
      throw new SettingsUserError("Diese Behandlung wurde nicht gefunden.");
    }
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
    await flashError("Archivieren fehlgeschlagen", settingsErrorMessage(err, "settings.treatment_archive"));
  } finally {
    if (clinicIdForRevalidate) revalidateTag(`kpi:${clinicIdForRevalidate}`);
    revalidatePath("/einstellungen");
  }
}

export async function createLocationAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
    const input = parseSettingsInput(
      z.object({
        name: z.string().trim().min(1).max(200),
        address: z.string().max(500).optional(),
      }),
      {
        name: formData.get("name"),
        address: formData.get("address") ?? undefined,
      }
    );

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
    await flashError("Standort konnte nicht angelegt werden", settingsErrorMessage(err, "settings.location_create"));
  } finally {
    // F-10: listLocations is cached under kpi:<clinicId> (10 min TTL).
    if (clinicIdForRevalidate) revalidateTag(`kpi:${clinicIdForRevalidate}`);
    revalidatePath("/einstellungen");
  }
}

export async function archiveLocationAction(formData: FormData) {
  let clinicIdForRevalidate: string | null = null;
  try {
    const session = await requireSession();
    clinicIdForRevalidate = session.clinicId;
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");
    const id = parseSettingsInput(z.string().uuid(), formData.get("locationId"));
    const archived = await withClinicContext(session.clinicId, session.userId, async (tx) =>
      tx
        .update(schema.locations)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.locations.id, id),
            eq(schema.locations.clinicId, session.clinicId)
          )
        )
        .returning({ id: schema.locations.id })
    );
    // V3 Neben 1: same as archiveTreatmentAction, no row means no audit.
    if (archived.length === 0) {
      throw new SettingsUserError("Dieser Standort wurde nicht gefunden.");
    }
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
    await flashError("Archivieren fehlgeschlagen", settingsErrorMessage(err, "settings.location_archive"));
  } finally {
    if (clinicIdForRevalidate) revalidateTag(`kpi:${clinicIdForRevalidate}`);
    revalidatePath("/einstellungen");
  }
}

// ============================================================
// EINS Bewertungen — Bewertungen & Reputation settings
// ============================================================

const ReviewUrlSchema = z
  .string()
  .url("Bitte eine vollständige URL angeben (https://…).")
  .max(500);

/**
 * The Jameda profile URL is fetched server-side by the review-sync worker,
 * so it must not become an SSRF vector: https only, jameda.de hosts only.
 */
const JamedaProfileUrlSchema = ReviewUrlSchema.refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (url.hostname === "jameda.de" || url.hostname.endsWith(".jameda.de"))
      );
    } catch {
      return false;
    }
  },
  { message: "Bitte eine https://www.jameda.de-Profil-URL angeben." }
);

/**
 * J-4: the links in review-request mails (sent from the EINS domain) may only
 * point at Google's / Jameda's real review pages and at the EINS landing app.
 */
const GoogleReviewUrlSchema = ReviewUrlSchema.refine(isAllowedGoogleReviewUrl, {
  message:
    "Bitte einen Google-Bewertungslink mit https:// angeben (search.google.com, g.page, maps.app.goo.gl oder google.com/maps).",
});
const JamedaReviewUrlSchema = ReviewUrlSchema.refine(isAllowedJamedaUrl, {
  message: "Bitte einen Jameda-Link mit https://www.jameda.de angeben.",
});
const ReviewLandingOriginSchema = ReviewUrlSchema.transform((value, ctx) => {
  const origin = normalizeAllowedLandingOrigin(
    value,
    env.CLINIC_LANDING_ORIGIN,
    env.CLINIC_LANDING_ORIGINS
  );
  if (!origin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Diese Adresse ist für die Bewertungsseite nicht freigegeben. Lassen Sie das Feld leer, dann gilt die Standardseite. Eine eigene Praxis-Domain richtet EINS für Sie ein.",
    });
    return z.NEVER;
  }
  return origin;
});

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
    const input = parseSettingsInput(
      z.object({
        reviewRequestEnabled: z.preprocess(
          (v) => v === "on" || v === "true" || v === true,
          z.boolean()
        ),
        reviewConsentAttested: z.preprocess(
          (v) => v === "on" || v === "true" || v === true,
          z.boolean()
        ),
        googleReviewUrl: GoogleReviewUrlSchema.optional().or(z.literal("")),
        jamedaReviewUrl: JamedaReviewUrlSchema.optional().or(z.literal("")),
        reviewLandingOrigin: ReviewLandingOriginSchema.optional().or(z.literal("")),
        reviewInboxEmail: z
          .string()
          .email("Ungültige E-Mail-Adresse.")
          .max(200)
          .optional()
          .or(z.literal("")),
        reviewRequestDelayDays: z.coerce.number().int().min(0).max(30),
        googlePlaceId: GooglePlaceIdSchema.optional().or(z.literal("")),
        jamedaProfileUrl: JamedaProfileUrlSchema.optional().or(z.literal("")),
      }),
      {
        reviewRequestEnabled: formData.get("reviewRequestEnabled") ?? "false",
        reviewConsentAttested:
          formData.get("reviewConsentAttested") ?? "false",
        googleReviewUrl: formData.get("googleReviewUrl") ?? undefined,
        jamedaReviewUrl: formData.get("jamedaReviewUrl") ?? undefined,
        reviewLandingOrigin: formData.get("reviewLandingOrigin") ?? undefined,
        reviewInboxEmail: formData.get("reviewInboxEmail") ?? undefined,
        reviewRequestDelayDays:
          formData.get("reviewRequestDelayDays") ?? 3,
        googlePlaceId: formData.get("googlePlaceId") ?? undefined,
        jamedaProfileUrl: formData.get("jamedaProfileUrl") ?? undefined,
      }
    );

    // Refuse to enable the program without at least one review URL —
    // otherwise the landing page has nowhere for satisfied patients to go.
    if (
      input.reviewRequestEnabled &&
      !input.googleReviewUrl &&
      !input.jamedaReviewUrl
    ) {
      throw new SettingsUserError(
        "Bitte hinterlegen Sie eine Google- oder Jameda-URL, bevor Sie die Bewertungs-Anfragen aktivieren."
      );
    }

    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .update(schema.clinics)
        .set({
          reviewRequestEnabled: input.reviewRequestEnabled,
          reviewConsentAttested: input.reviewConsentAttested,
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
        reviewConsentAttested: input.reviewConsentAttested,
        hasGoogleUrl: Boolean(input.googleReviewUrl),
        hasJamedaUrl: Boolean(input.jamedaReviewUrl),
        hasGooglePlaceId: Boolean(input.googlePlaceId),
        hasJamedaProfileUrl: Boolean(input.jamedaProfileUrl),
        delayDays: input.reviewRequestDelayDays,
        // Record the notification-target inbox + landing origin verbatim
        // (pentest L11): these are operator-controlled routing fields. A
        // settings.team user who repoints reviewInboxEmail to an external
        // address would otherwise exfiltrate negative-feedback alerts with no
        // trace; capturing the value makes the repoint tamper-evident.
        reviewInboxEmail: input.reviewInboxEmail || null,
        reviewLandingOrigin: input.reviewLandingOrigin || null,
      },
    });

    await flashSuccess("Bewertungs-Einstellungen gespeichert");
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", settingsErrorMessage(err, "settings.reviews"));
  } finally {
    if (clinicIdForRevalidate) {
      revalidateTag(`clinic:${clinicIdForRevalidate}`);
    }
    revalidatePath("/einstellungen");
  }
}

/** Result of "Jetzt aktualisieren", rendered by ReviewSyncButton. */
export type ReviewSyncState =
  | undefined
  | {
      ok: boolean;
      message: string;
      platforms: Array<{ platform: "google" | "jameda"; ok: boolean }>;
    };

const REVIEW_SYNC_LIMIT = { limit: 1, windowSeconds: 5 * 60 } as const;

/**
 * Manually trigger the review syncs for this clinic (B-20 / F-25 / F-30).
 * At most once per 5 minutes per Praxis (external APIs cost quota). Runs
 * inline and returns the per-platform result to the client component, so no
 * flash cookie has to be deleted during a server render. Errors of the
 * platforms are logged, the Praxis sees a plain German status.
 */
export async function syncReviewsNowAction(
  _prev: ReviewSyncState,
  _formData: FormData
): Promise<ReviewSyncState> {
  try {
    const session = await requireSession();
    if (!can(session.role, "reviews.manage")) {
      throw new ForbiddenError("reviews.manage");
    }
    const rl = await rateLimit("reviews:sync-now:clinic", session.clinicId, REVIEW_SYNC_LIMIT);
    if (!rl.ok) {
      const minutes = Math.max(1, Math.ceil(rl.resetInSeconds / 60));
      return {
        ok: false,
        message: `Der Abgleich lief gerade erst. Bitte versuchen Sie es in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"} erneut.`,
        platforms: [],
      };
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

    revalidatePath("/bewertungen");
    revalidatePath("/dashboard");

    const platforms = outcomes.map((o) => ({ platform: o.platform, ok: o.ok }));
    const allOk = platforms.every((p) => p.ok);
    return {
      ok: allOk,
      message: allOk
        ? "Bewertungen sind aktualisiert."
        : "Nicht alle Plattformen konnten abgefragt werden. Bitte prüfen Sie die hinterlegten Profile oder versuchen Sie es später erneut.",
      platforms,
    };
  } catch (err) {
    return {
      ok: false,
      message: settingsErrorMessage(err, "settings.reviews_sync"),
      platforms: [],
    };
  }
}

/** Grace window in which the secret before a rotation still verifies. */
const INTAKE_SECRET_GRACE_HOURS = 24;

export type RotateIntakeSecretState =
  | undefined
  | { ok: true; secret: string }
  | { ok: false; error: string };

/**
 * Rotate the per-clinic HMAC secret used by /api/leads/intake (Zielseiten
 * forms). C-34 / F-11: the previous secret stays valid for 24 h
 * (platform_credentials.previous_access_token_enc), so a rotation no longer
 * rejects every Anfrage until EINS updates the Zielseite. Rotating twice in a
 * row drops the original secret at once (leak response). The client
 * component asks for confirmation first.
 *
 * F-30: the plaintext goes straight back to the client component (shown
 * once), no flash cookie that a server render would have to delete.
 */
export async function rotateIntakeSecretAction(
  _prev: RotateIntakeSecretState,
  _formData: FormData
): Promise<RotateIntakeSecretState> {
  try {
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
        set: {
          accessTokenEnc: ciphertext,
          // The existing row's current secret becomes the grace secret.
          previousAccessTokenEnc: sql`${schema.platformCredentials.accessTokenEnc}`,
          previousValidUntil: sql`now() + (${INTAKE_SECRET_GRACE_HOURS}::int * interval '1 hour')`,
        },
      });

    // Drop the cached old secret so the next /api/leads/intake verification
    // on this instance reads the new row (other instances re-read on their
    // first mismatch, see clinic-signature.ts).
    invalidateSignatureSecretCache(session.clinicId, "intake");

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "rotate",
      entityKind: "intake_secret",
      diff: { graceHours: INTAKE_SECRET_GRACE_HOURS },
    });

    return { ok: true, secret: plaintext };
  } catch (err) {
    return { ok: false, error: settingsErrorMessage(err, "settings.intake_rotate") };
  }
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

    const input = parseSettingsInput(
      z.object({
        metaPixelId: MetaPixelIdSchema.optional().or(z.literal("")),
        googleAdsCustomerId: GoogleAdsCustomerIdSchema.optional().or(
          z.literal("")
        ),
        googleAdsConversionAction:
          GoogleAdsConversionActionSchema.optional().or(z.literal("")),
        googleAdsLoginCustomerId: OptionalMccSchema,
      }),
      {
        metaPixelId: formData.get("metaPixelId") ?? undefined,
        googleAdsCustomerId: formData.get("googleAdsCustomerId") ?? undefined,
        googleAdsConversionAction:
          formData.get("googleAdsConversionAction") ?? undefined,
        googleAdsLoginCustomerId:
          formData.get("googleAdsLoginCustomerId") ?? undefined,
      }
    );

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

    await flashSuccess("Einstellungen für Abschluss-Meldungen gespeichert");
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", settingsErrorMessage(err, "settings.ads_conversion"));
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
