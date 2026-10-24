"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { enqueueRetreatmentRefresh } from "@/server/jobs";
import { can, ForbiddenError } from "@/lib/roles";
import { flashError, flashMessageFromError, flashSuccess } from "@/lib/flash";
import { RETREATMENT_MODES, type RetreatmentMode } from "@/lib/retreatment";

const PATH = "/wiederbehandlungen";

const checkbox = (v: FormDataEntryValue | null) => v === "on" || v === "true";

function parseId(v: FormDataEntryValue | null): string {
  const r = z.string().uuid().safeParse(v);
  if (!r.success) throw new Error("Eintrag nicht gefunden.");
  return r.data;
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Eingabe ungültig.";
}

const BookingUrlSchema = z
  .string()
  .trim()
  .max(500, "Die Adresse ist zu lang.")
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Bitte eine vollständige Adresse angeben, die mit https:// beginnt.");

const PhoneSchema = z
  .string()
  .trim()
  .max(40, "Die Telefonnummer ist zu lang.")
  .refine((v) => !v || /^[+0-9 ()/\-]{5,40}$/.test(v), "Bitte nur Ziffern, Leerzeichen und + ( ) / - verwenden.");

/** Inhaber: switch reminders on/off and say where patients book. */
export async function updateRetreatmentSettingsAction(formData: FormData) {
  try {
    const session = await requireSession();
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");

    const enabled = checkbox(formData.get("remindersEnabled"));
    const attested = checkbox(formData.get("consentAttested"));
    const url = BookingUrlSchema.safeParse(String(formData.get("bookingUrl") ?? ""));
    if (!url.success) throw new Error(firstIssue(url.error));
    const phone = PhoneSchema.safeParse(String(formData.get("phone") ?? ""));
    if (!phone.success) throw new Error(firstIssue(phone.error));

    if (enabled && !attested) {
      throw new Error(
        "Bitte bestätigen Sie zuerst, dass Ihre Patientinnen und Patienten über die Erinnerung informiert werden."
      );
    }
    if (enabled && !url.data && !phone.data) {
      throw new Error("Bitte hinterlegen Sie einen Buchungslink oder eine Telefonnummer.");
    }

    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .update(schema.clinics)
        .set({
          retreatmentRemindersEnabled: enabled,
          retreatmentConsentAttested: attested,
          retreatmentBookingUrl: url.data || null,
          retreatmentPhone: phone.data || null,
        })
        .where(eq(schema.clinics.id, session.clinicId));
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "clinic_retreatment_settings",
      // Booking URL verbatim: it is where patient clicks get sent, so a
      // repoint must be traceable.
      diff: { enabled, attested, bookingUrl: url.data || null, hasPhone: Boolean(phone.data) },
    });

    await flashSuccess(
      "Einstellungen gespeichert",
      enabled ? "Erinnerungen werden ab morgen früh verschickt." : "Es werden keine Erinnerungen verschickt."
    );
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath(PATH);
  }
}

/** Inhaber: per treatment, use the PVS interval, a fixed one, or keep it out. */
export async function updateRetreatmentTreatmentsAction(formData: FormData) {
  try {
    const session = await requireSession();
    if (!can(session.role, "settings.team")) throw new ForbiddenError("settings.team");

    const changed = await withClinicContext(session.clinicId, session.userId, async (tx) => {
      const treatments = await tx
        .select({ id: schema.treatments.id, name: schema.treatments.name })
        .from(schema.treatments)
        .where(and(eq(schema.treatments.clinicId, session.clinicId), isNull(schema.treatments.archivedAt)));

      const updates: Array<{ id: string; mode: RetreatmentMode; months: number | null }> = [];
      for (const t of treatments) {
        const rawMode = formData.get(`mode_${t.id}`);
        if (rawMode === null) continue; // not on the form (e.g. inactive treatment)
        const mode = String(rawMode) as RetreatmentMode;
        if (!RETREATMENT_MODES.includes(mode)) throw new Error("Ungültige Auswahl.");
        const rawMonths = String(formData.get(`months_${t.id}`) ?? "").trim();
        let months: number | null = null;
        if (rawMonths) {
          const n = Number(rawMonths);
          if (!Number.isInteger(n) || n < 1 || n > 36) {
            throw new Error(`${t.name}: Abstand bitte als ganze Zahl zwischen 1 und 36 Monaten.`);
          }
          months = n;
        }
        if (mode === "fixed" && months === null) {
          throw new Error(`${t.name}: Bitte einen festen Abstand in Monaten eintragen.`);
        }
        updates.push({ id: t.id, mode, months });
      }

      for (const u of updates) {
        await tx
          .update(schema.treatments)
          .set({ retreatmentMode: u.mode, retreatmentIntervalMonths: u.months })
          .where(and(eq(schema.treatments.id, u.id), eq(schema.treatments.clinicId, session.clinicId)));
      }
      return updates;
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "treatment_retreatment_intervals",
      diff: { treatments: changed },
    });

    await enqueueRetreatmentRefresh(session.clinicId);
    await flashSuccess("Abstände gespeichert", "Der Kalender wird in wenigen Sekunden neu berechnet.");
  } catch (err) {
    await flashError("Speichern fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath(PATH);
  }
}

/** Team: take a patient off the calendar for this cycle (no reminder, not in the lists). */
export async function dismissRetreatmentAction(formData: FormData) {
  try {
    const session = await requireSession();
    if (!can(session.role, "requests.update")) throw new ForbiddenError("requests.update");
    const id = parseId(formData.get("id"));
    const t = schema.retreatmentCycles;
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .update(t)
        .set({ status: "dismissed", dismissedAt: new Date(), dismissedBy: session.userId, updatedAt: new Date() })
        .where(and(eq(t.id, id), eq(t.clinicId, session.clinicId), inArray(t.status, ["open", "booked"])));
    });
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "retreatment_cycle",
      entityId: id,
      diff: { status: "dismissed" },
    });
    await flashSuccess("Ausgeblendet", "Diese Person bekommt für diese Behandlung keine Erinnerung.");
  } catch (err) {
    await flashError("Aktion fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath(PATH);
  }
}

/** Team: undo a dismiss. The next rebuild sets 'booked' again if a date exists. */
export async function restoreRetreatmentAction(formData: FormData) {
  try {
    const session = await requireSession();
    if (!can(session.role, "requests.update")) throw new ForbiddenError("requests.update");
    const id = parseId(formData.get("id"));
    const t = schema.retreatmentCycles;
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .update(t)
        .set({ status: "open", dismissedAt: null, dismissedBy: null, updatedAt: new Date() })
        .where(and(eq(t.id, id), eq(t.clinicId, session.clinicId), eq(t.status, "dismissed")));
    });
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "retreatment_cycle",
      entityId: id,
      diff: { status: "open" },
    });
    await enqueueRetreatmentRefresh(session.clinicId);
    await flashSuccess("Wieder im Kalender");
  } catch (err) {
    await flashError("Aktion fehlgeschlagen", flashMessageFromError(err));
  } finally {
    revalidatePath(PATH);
  }
}
