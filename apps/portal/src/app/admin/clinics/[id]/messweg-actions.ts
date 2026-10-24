"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import {
  BOOKING_LINK_MEDIA,
  TRACKING_NUMBER_CHANNELS,
  toE164,
} from "@/lib/messweg";

/**
 * Admin-side Messwege (tracking numbers, booking links) for one Praxis.
 * Same guard as ./actions.ts: re-check the admin session, validate with zod,
 * write an audit row, input errors redirect back with ?fehler=….
 */

const TAB = "messwege";

/** Calendly event type URIs look like https://api.calendly.com/event_types/<uuid>. */
const CALENDLY_EVENT_TYPE_PREFIX = "https://api.calendly.com/event_types/";

function failTo(clinicId: string | undefined, message: string): never {
  if (!clinicId) redirect("/admin/clinics");
  redirect(`/admin/clinics/${clinicId}?tab=${TAB}&fehler=${encodeURIComponent(message)}`);
}

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `Eingabe ungültig (${i.path.join(".") || "Formular"}): ${i.message}` : "Eingabe ungültig.";
}

function formClinicId(formData: FormData): string | undefined {
  const v = formData.get("clinicId");
  return typeof v === "string" && z.string().uuid().safeParse(v).success ? v : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function revalidate(clinicId: string) {
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/onboarding/checkliste");
}

const optionalLabel = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : null));

// ---------------------------------------------------------------
// Tracking-Nummern
// ---------------------------------------------------------------

const CreateTrackingNumberSchema = z.object({
  clinicId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  channel: z.enum(TRACKING_NUMBER_CHANNELS),
  label: optionalLabel,
});

export async function createTrackingNumberAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = CreateTrackingNumberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;

  const e164 = toE164(d.number);
  if (!e164) {
    failTo(
      d.clinicId,
      "Die Nummer ist keine gültige Telefonnummer. Bitte z. B. als +49 221 1234567 oder 0221 1234567 eingeben."
    );
  }

  let createdId: string | null = null;
  let conflict = false;
  try {
    const [row] = await db
      .insert(schema.trackingNumbers)
      .values({
        clinicId: d.clinicId,
        e164,
        channel: d.channel,
        provider: "matelso",
        label: d.label,
      })
      .returning({ id: schema.trackingNumbers.id });
    createdId = row?.id ?? null;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    conflict = true;
  }

  if (conflict) {
    const [holder] = await db
      .select({ clinicId: schema.trackingNumbers.clinicId })
      .from(schema.trackingNumbers)
      .where(and(eq(schema.trackingNumbers.e164, e164), eq(schema.trackingNumbers.active, true)))
      .limit(1);
    failTo(
      d.clinicId,
      holder?.clinicId === d.clinicId
        ? "Diese Nummer ist bei dieser Praxis schon aktiv."
        : "Diese Nummer ist bei einer anderen Praxis aktiv. Erst dort deaktivieren."
    );
  }

  await writeAudit({
    clinicId: d.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "tracking_number",
    entityId: createdId ?? undefined,
    diff: { e164, channel: d.channel, label: d.label },
  });

  revalidate(d.clinicId);
}

const DeactivateSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
});

export async function deactivateTrackingNumberAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = DeactivateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;

  const [row] = await db
    .update(schema.trackingNumbers)
    .set({ active: false, deactivatedAt: new Date() })
    .where(
      and(
        eq(schema.trackingNumbers.id, d.id),
        eq(schema.trackingNumbers.clinicId, d.clinicId),
        eq(schema.trackingNumbers.active, true)
      )
    )
    .returning({ id: schema.trackingNumbers.id, e164: schema.trackingNumbers.e164 });
  if (!row) failTo(d.clinicId, "Die Nummer ist nicht mehr aktiv oder gehört nicht zu dieser Praxis.");

  await writeAudit({
    clinicId: d.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "tracking_number",
    entityId: row.id,
    diff: { e164: row.e164, active: { from: true, to: false } },
  });

  revalidate(d.clinicId);
}

// ---------------------------------------------------------------
// Buchungslinks
// ---------------------------------------------------------------

const CreateBookingLinkSchema = z.object({
  clinicId: z.string().uuid(),
  url: z.string().trim().min(1).max(500),
  externalRef: z.string().trim().min(1).max(500),
  medium: z.enum(BOOKING_LINK_MEDIA),
  label: optionalLabel,
});

export async function createBookingLinkAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = CreateBookingLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;

  if (!d.url.startsWith("https://") || !z.string().url().safeParse(d.url).success) {
    failTo(d.clinicId, "Der Link muss mit https:// beginnen.");
  }
  if (
    !d.externalRef.startsWith(CALENDLY_EVENT_TYPE_PREFIX) ||
    d.externalRef.length === CALENDLY_EVENT_TYPE_PREFIX.length
  ) {
    failTo(
      d.clinicId,
      `Der Calendly-Ereignistyp muss die URI des Ereignistyps sein, z. B. ${CALENDLY_EVENT_TYPE_PREFIX}… (nicht der öffentliche Buchungslink).`
    );
  }

  let createdId: string | null = null;
  let conflict = false;
  try {
    const [row] = await db
      .insert(schema.bookingLinks)
      .values({
        clinicId: d.clinicId,
        provider: "calendly",
        url: d.url,
        externalRef: d.externalRef,
        medium: d.medium,
        label: d.label,
      })
      .returning({ id: schema.bookingLinks.id });
    createdId = row?.id ?? null;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    conflict = true;
  }

  if (conflict) {
    const [holder] = await db
      .select({ clinicId: schema.bookingLinks.clinicId })
      .from(schema.bookingLinks)
      .where(
        and(
          eq(schema.bookingLinks.provider, "calendly"),
          eq(schema.bookingLinks.externalRef, d.externalRef),
          eq(schema.bookingLinks.active, true)
        )
      )
      .limit(1);
    failTo(
      d.clinicId,
      holder?.clinicId === d.clinicId
        ? "Dieser Calendly-Ereignistyp ist bei dieser Praxis schon aktiv."
        : "Dieser Calendly-Ereignistyp ist bei einer anderen Praxis aktiv. Erst dort deaktivieren."
    );
  }

  await writeAudit({
    clinicId: d.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "booking_link",
    entityId: createdId ?? undefined,
    diff: { url: d.url, externalRef: d.externalRef, medium: d.medium, label: d.label },
  });

  revalidate(d.clinicId);
}

export async function deactivateBookingLinkAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = DeactivateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;

  const [row] = await db
    .update(schema.bookingLinks)
    .set({ active: false, deactivatedAt: new Date() })
    .where(
      and(
        eq(schema.bookingLinks.id, d.id),
        eq(schema.bookingLinks.clinicId, d.clinicId),
        eq(schema.bookingLinks.active, true)
      )
    )
    .returning({ id: schema.bookingLinks.id, url: schema.bookingLinks.url });
  if (!row) failTo(d.clinicId, "Der Buchungslink ist nicht mehr aktiv oder gehört nicht zu dieser Praxis.");

  await writeAudit({
    clinicId: d.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "booking_link",
    entityId: row.id,
    diff: { url: row.url, active: { from: true, to: false } },
  });

  revalidate(d.clinicId);
}
