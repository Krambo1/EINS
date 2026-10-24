"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { issueMagicLink } from "@/auth/magic-link";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { applyDefaultJourney } from "@/server/timeline-journey";
import { isIsoDate } from "@/lib/guarantee-clock";
import { berlinDateString } from "@/lib/formatting";
import { slugifyClinicName } from "./slug";

/**
 * Admin onboarding of a new Praxis (G-01). Creates the clinic row, the owner
 * (Inhaber) login without a password, optionally the guarantee clock, seeds
 * the default Fortschritt-Journey, then emails the owner the same invite
 * magic-link a Praxis owner sends to a team member (intent "invite",
 * MAGIC_LINK_TTL like reset links). The link lands on /set-password.
 *
 * Business-rule failures redirect back with ?fehler=… (same pattern as the
 * Garantie actions) instead of throwing into the error boundary.
 */

const CreateClinicSchema = z.object({
  displayName: z.string().trim().min(2, "Anzeigename fehlt").max(200),
  legalName: z.string().trim().max(200).optional().or(z.literal("")),
  slug: z.string().trim().max(80).optional().or(z.literal("")),
  ownerName: z.string().trim().min(2, "Name der Inhaberin oder des Inhabers fehlt").max(200),
  ownerEmail: z.string().trim().toLowerCase().email("E-Mail-Adresse ist ungültig").max(200),
  signedOn: z.string().optional().or(z.literal("")),
});

function failCreate(message: string): never {
  redirect(`/admin/clinics/neu?fehler=${encodeURIComponent(message)}`);
}

export async function createClinicAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = CreateClinicSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    failCreate(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }
  const d = parsed.data;

  const slug = slugifyClinicName(d.slug && d.slug.length > 0 ? d.slug : d.displayName);
  if (slug.length < 2) failCreate("Kurzname (Slug) ist zu kurz.");

  const signedOn = d.signedOn && d.signedOn.length > 0 ? d.signedOn : null;
  if (signedOn !== null) {
    if (!isIsoDate(signedOn)) failCreate("Unterschriftsdatum ist ungültig.");
    if (signedOn > berlinDateString(new Date())) {
      failCreate("Unterschriftsdatum liegt in der Zukunft.");
    }
  }

  const [slugTaken] = await db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(eq(schema.clinics.slug, slug))
    .limit(1);
  if (slugTaken) failCreate(`Der Kurzname "${slug}" ist schon vergeben.`);

  // Login and password reset resolve the user by e-mail alone (first active
  // match), so the same address must not be active in two Praxen.
  const [emailTaken] = await db
    .select({ id: schema.clinicUsers.id })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.email, d.ownerEmail),
        isNull(schema.clinicUsers.archivedAt)
      )
    )
    .limit(1);
  if (emailTaken) {
    failCreate("Diese E-Mail-Adresse hat schon einen aktiven Zugang in einer anderen Praxis.");
  }

  let created: { clinicId: string; userId: string };
  try {
    created = await db.transaction(async (tx) => {
      const [clinic] = await tx
        .insert(schema.clinics)
        .values({
          displayName: d.displayName,
          legalName: d.legalName && d.legalName.length > 0 ? d.legalName : d.displayName,
          slug,
        })
        .returning({ id: schema.clinics.id });
      const clinicId = clinic!.id;

      const [user] = await tx
        .insert(schema.clinicUsers)
        .values({
          clinicId,
          email: d.ownerEmail,
          fullName: d.ownerName,
          role: "inhaber",
          invitedAt: new Date(),
        })
        .returning({ id: schema.clinicUsers.id });

      if (signedOn !== null) {
        await tx.insert(schema.guaranteeClocks).values({ clinicId, signedOn });
      }
      return { clinicId, userId: user!.id };
    });
  } catch (err) {
    // 23505: a concurrent create took the slug between check and insert.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") failCreate(`Der Kurzname "${slug}" ist schon vergeben.`);
    throw err;
  }

  const { seeded } = await applyDefaultJourney(created.clinicId);

  // issueMagicLink never throws on a send failure (logs + audits instead).
  await issueMagicLink({
    email: d.ownerEmail,
    intent: "invite",
    userId: created.userId,
    clinicName: d.displayName,
  });

  await writeAudit({
    clinicId: created.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "admin_clinic",
    entityId: created.clinicId,
    diff: {
      slug,
      displayName: d.displayName,
      ownerUserId: created.userId,
      signedOn,
      seededDefaultJourney: seeded,
    },
  });
  await writeAudit({
    clinicId: created.clinicId,
    actorEmail: admin.email,
    action: "invite",
    entityKind: "clinic_user",
    entityId: created.userId,
    diff: { role: "inhaber", via: "admin" },
  });

  revalidatePath("/admin/clinics");
  revalidatePath("/admin/garantie");
  redirect(
    `/admin/clinics/${created.clinicId}?tab=team&hinweis=${encodeURIComponent(
      "Praxis angelegt. Die Einladung ist an " + d.ownerEmail + " unterwegs."
    )}`
  );
}

/**
 * Re-send the invite link to a member who has not set a password yet (or who
 * let the 15-minute link expire). Only for active members without login.
 */
export async function resendInviteAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({ clinicId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/clinics");
  const { clinicId, userId } = parsed.data;
  const back = `/admin/clinics/${clinicId}?tab=team`;

  const [row] = await db
    .select({
      email: schema.clinicUsers.email,
      archivedAt: schema.clinicUsers.archivedAt,
      passwordHash: schema.clinicUsers.passwordHash,
      clinicName: schema.clinics.displayName,
      clinicArchivedAt: schema.clinics.archivedAt,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(
      and(eq(schema.clinicUsers.id, userId), eq(schema.clinicUsers.clinicId, clinicId))
    )
    .limit(1);

  if (!row || row.archivedAt || row.clinicArchivedAt) {
    redirect(`${back}&fehler=${encodeURIComponent("Zugang ist archiviert oder existiert nicht.")}`);
  }
  if (row.passwordHash) {
    redirect(
      `${back}&fehler=${encodeURIComponent(
        "Dieser Zugang hat schon ein Passwort. Die Person kann unter Passwort vergessen einen neuen Link anfordern."
      )}`
    );
  }

  await db
    .update(schema.clinicUsers)
    .set({ invitedAt: new Date() })
    .where(eq(schema.clinicUsers.id, userId));

  await issueMagicLink({
    email: row.email,
    intent: "invite",
    userId,
    clinicName: row.clinicName,
  });

  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: "invite",
    entityKind: "clinic_user",
    entityId: userId,
    diff: { resent: true, via: "admin" },
  });

  revalidatePath(`/admin/clinics/${clinicId}`);
  redirect(`${back}&hinweis=${encodeURIComponent("Einladung erneut verschickt an " + row.email + ".")}`);
}
