"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { enqueueRetreatmentRefresh } from "@/server/jobs";
import { can, ForbiddenError } from "@/lib/roles";
import { flashError, flashMessageFromError, flashSuccess } from "@/lib/flash";
import { RETREATMENT_MODES, type RetreatmentMode } from "@/lib/retreatment";
import type { ActionResult } from "../anfragen/[id]/actions";

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
    revalidatePath("/dashboard");
    revalidatePath("/anfragen");
    revalidatePath("/einstellungen");
    revalidatePath("/onboarding");
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
    revalidatePath("/dashboard");
    revalidatePath("/anfragen");
    revalidatePath("/einstellungen");
    revalidatePath("/onboarding");
  }
}

// ---------------------------------------------------------------------------
// The team's work on one cycle: calls from the call cards of /anfragen, and
// taking a patient off the calendar or back on (call cards, Anfrage page).
// Each returns a result for the toast (one tap saves, the card keeps its
// size), and each leaves a note in the Verlauf of the patient's Anfrage, so
// the history of a Wiederbehandlung is where the team looks for it.
// ---------------------------------------------------------------------------

/** An error whose message is safe and meant for the Praxis team. */
class UserFacingError extends Error {}

const NOT_OPEN = "Diese Wiederbehandlung ist nicht mehr offen. Bitte laden Sie die Seite neu.";
const NOT_DISMISSED = "Diese Wiederbehandlung ist nicht ausgeblendet. Bitte laden Sie die Seite neu.";

async function toResult(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    // Redirects (e.g. expired session in requireSession) must propagate.
    unstable_rethrow(err);
    if (err instanceof UserFacingError) return { ok: false, message: err.message };
    if (err instanceof ForbiddenError) return { ok: false, message: "Dafür fehlt Ihnen die Berechtigung." };
    console.error("[wiederbehandlungen] action failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: "Speichern hat nicht geklappt. Bitte versuchen Sie es noch einmal." };
  }
}

type Tx = Parameters<Parameters<typeof withClinicContext>[2]>[0];

/** The cycle, locked, with what the note on its Anfrage needs. */
async function lockCycle(tx: Tx, clinicId: string, id: string) {
  const t = schema.retreatmentCycles;
  const [row] = await tx
    .select({ status: t.status, requestId: t.requestId, treatmentName: schema.treatments.name })
    .from(t)
    .innerJoin(schema.treatments, eq(t.treatmentId, schema.treatments.id))
    .where(and(eq(t.id, id), eq(t.clinicId, clinicId)))
    .limit(1)
    .for("update", { of: t });
  return row ?? null;
}

async function noteOnAnfrage(
  tx: Tx,
  requestId: string | null,
  actorId: string,
  body: string,
  meta: Record<string, string>
) {
  if (!requestId) return;
  // A note, not a call: a call activity would count as the Anfrage's first
  // contact attempt (response-time.ts) months after it came in.
  await tx.insert(schema.requestActivities).values({ requestId, actorId, kind: "note", body, meta });
}

function revalidateRetreatment(requestId: string | null) {
  revalidatePath("/anfragen");
  if (requestId) revalidatePath(`/anfragen/${requestId}`);
  revalidatePath("/dashboard");
}

const CallSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["termin_vereinbart", "nicht_erreicht", "kein_interesse"]),
});

const CALL_NOTES: Record<z.infer<typeof CallSchema>["outcome"], string> = {
  termin_vereinbart: "Termin vereinbart",
  nicht_erreicht: "nicht erreicht",
  kein_interesse: "kein Interesse, ausgeblendet",
};

/**
 * Team: the result of a call from the call cards. "Termin vereinbart" takes
 * the patient out of the cards until the date arrives from the PVS
 * (CALLED_TERMIN_HOLD_DAYS), "Nicht erreicht" puts them behind everyone not
 * called yet, "Kein Interesse" takes them off the calendar for this cycle
 * (undo: restoreRetreatmentAction).
 */
export async function logRetreatmentCall(formData: FormData): Promise<ActionResult> {
  let requestId: string | null = null;
  const result = await toResult(async () => {
    const session = await requireSession();
    if (!can(session.role, "requests.update")) throw new ForbiddenError("requests.update");
    const input = CallSchema.safeParse({ id: formData.get("id"), outcome: formData.get("outcome") });
    if (!input.success) throw new UserFacingError("Eintrag nicht gefunden.");
    const { id, outcome } = input.data;
    const t = schema.retreatmentCycles;
    const now = new Date();
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      const cycle = await lockCycle(tx, session.clinicId, id);
      if (!cycle || !["open", "booked"].includes(cycle.status)) throw new UserFacingError(NOT_OPEN);
      requestId = cycle.requestId;
      // "Kein Interesse" only hides the cycle, so "Rückgängig" puts the
      // patient back exactly where they were; the call itself is the note.
      await tx
        .update(t)
        .set(
          outcome === "kein_interesse"
            ? { status: "dismissed", dismissedAt: now, dismissedBy: session.userId, updatedAt: now }
            : { lastCallAt: now, lastCallOutcome: outcome, updatedAt: now }
        )
        .where(eq(t.id, id));
      await noteOnAnfrage(
        tx,
        cycle.requestId,
        session.userId,
        `Wiederbehandlung ${cycle.treatmentName}: angerufen, ${CALL_NOTES[outcome]}.`,
        { retreatmentCycleId: id, outcome }
      );
    });
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "retreatment_cycle",
      entityId: id,
      diff: outcome === "kein_interesse" ? { status: "dismissed", call: outcome } : { call: outcome },
    });
  });
  revalidateRetreatment(requestId);
  return result;
}

/** Team: take a patient off the calendar for this cycle (no reminder, not in the call cards). */
export async function dismissRetreatmentAction(formData: FormData): Promise<ActionResult> {
  let requestId: string | null = null;
  const result = await toResult(async () => {
    const session = await requireSession();
    if (!can(session.role, "requests.update")) throw new ForbiddenError("requests.update");
    const id = parseId(formData.get("id"));
    const t = schema.retreatmentCycles;
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      const cycle = await lockCycle(tx, session.clinicId, id);
      if (!cycle || !["open", "booked"].includes(cycle.status)) throw new UserFacingError(NOT_OPEN);
      requestId = cycle.requestId;
      await tx
        .update(t)
        .set({ status: "dismissed", dismissedAt: new Date(), dismissedBy: session.userId, updatedAt: new Date() })
        .where(eq(t.id, id));
      await noteOnAnfrage(tx, cycle.requestId, session.userId, `Wiederbehandlung ${cycle.treatmentName}: ausgeblendet.`, {
        retreatmentCycleId: id,
        status: "dismissed",
      });
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
  });
  revalidateRetreatment(requestId);
  return result;
}

/** Team: undo a dismiss. The next rebuild sets 'booked' again if a date exists. */
export async function restoreRetreatmentAction(formData: FormData): Promise<ActionResult> {
  let requestId: string | null = null;
  const result = await toResult(async () => {
    const session = await requireSession();
    if (!can(session.role, "requests.update")) throw new ForbiddenError("requests.update");
    const id = parseId(formData.get("id"));
    const t = schema.retreatmentCycles;
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      const cycle = await lockCycle(tx, session.clinicId, id);
      if (!cycle || cycle.status !== "dismissed") throw new UserFacingError(NOT_DISMISSED);
      requestId = cycle.requestId;
      await tx
        .update(t)
        .set({ status: "open", dismissedAt: null, dismissedBy: null, updatedAt: new Date() })
        .where(eq(t.id, id));
      await noteOnAnfrage(tx, cycle.requestId, session.userId, `Wiederbehandlung ${cycle.treatmentName}: wieder aufgenommen.`, {
        retreatmentCycleId: id,
        status: "open",
      });
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
  });
  revalidateRetreatment(requestId);
  return result;
}
