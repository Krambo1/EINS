"use server";

// Lead-Cockpit — write actions for the PRE-BOOKING phase of a lead.
//
// Boundary (see migration 0052 + the PVS-bridge review):
//   A fresh Anfrage is a stranger, not yet a patient — the PVS cannot see
//   it, so no upstream source of truth exists. That is exactly the
//   "genuinely portal-native" exception. We re-open the portal as the
//   working surface here: log calls, take notes, set the working status,
//   schedule Wiedervorlagen.
//
//   The moment a lead is linked to a PVS appointment (`pvs_appointment_id`
//   IS NOT NULL), the PVS owns its lifecycle: `changeStatus` refuses to
//   touch it (the UI disables the control too). Calls/notes/Wiedervorlagen
//   remain allowed — they are observations the PVS never carries.
//
// Every action: requireSession → can("requests.update") → zod-parse →
// withClinicContext (RLS) → writeAudit → revalidatePath.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z, ZodError } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { invalidateClinicKpiCache } from "@/server/queries/_cache";
import { invalidateNavBadges } from "@/server/queries/navBadgesCache";
import { can, ForbiddenError } from "@/lib/roles";
import {
  CALL_OUTCOMES,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  STATUS_TRANSITIONS,
  type RequestStatus,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import { parseBerlinLocalInput } from "../_lib/berlin-input";
import { FOLLOWUP_DATE_MISSING, FOLLOWUP_DATE_PAST, isPastBerlinDay } from "./_followup-date";

const IdSchema = z.string().uuid();

/**
 * Result of the cockpit actions. Thrown errors reach the browser in
 * production only as Next's generic English text, so the actions return a
 * German message instead (C-25).
 */
export type ActionResult = { ok: true } | { ok: false; message: string };

/** An error whose message is safe and meant for the Praxis team. */
class UserFacingError extends Error {}

const STALE_MESSAGE =
  "Die Anfrage wurde inzwischen von jemand anderem geändert. Bitte laden Sie die Seite neu.";

async function toResult(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    // Redirects (e.g. expired session in requireSession) must propagate.
    unstable_rethrow(err);
    if (err instanceof UserFacingError) return { ok: false, message: err.message };
    if (err instanceof ForbiddenError)
      return { ok: false, message: "Dafür fehlt Ihnen die Berechtigung." };
    if (err instanceof ZodError)
      return { ok: false, message: "Bitte prüfen Sie Ihre Eingaben." };
    console.error("[anfragen] action failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      message: "Speichern hat nicht geklappt. Bitte versuchen Sie es noch einmal.",
    };
  }
}

/** `datetime-local` value, read as Berlin wall-clock time (C-16). */
const BerlinLocalDate = z.string().transform((value, ctx) => {
  const d = parseBerlinLocalInput(value);
  if (!d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ungültiges Datum." });
    return z.NEVER;
  }
  return d;
});

function transitionError(from: string, to: RequestStatus): UserFacingError {
  const fromLabel = REQUEST_STATUS_LABELS[from as RequestStatus] ?? from;
  return new UserFacingError(
    `Von „${fromLabel}“ lässt sich nicht direkt auf „${REQUEST_STATUS_LABELS[to]}“ wechseln.`
  );
}

/** Read an optional, non-empty FormData string (empty string → undefined). */
function optStr(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function revalidateLead(id: string, clinicId: string, userId: string) {
  revalidatePath(`/anfragen/${id}`);
  revalidatePath("/anfragen");
  // The dashboard renders dynamically; only its cached aggregates (tag
  // kpi:<clinic>) and the sidebar badges need busting (D-6).
  void invalidateClinicKpiCache(clinicId);
  invalidateNavBadges(clinicId, userId);
}

/**
 * Log a phone-call attempt. Captures the per-call outcome and, in the same
 * transaction, optionally flips the lead status and schedules a Wiedervorlage
 * — because the real workflow ("didn't pick up → mark Nicht erreicht →
 * Rückruf morgen 14:00") is a single submit. Stamps `firstContactedAt` on the
 * first call (the response-time proof).
 */
export async function logCall(formData: FormData): Promise<ActionResult> {
  return toResult(() => logCallImpl(formData));
}

async function logCallImpl(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({
      id: IdSchema,
      outcome: z.enum(CALL_OUTCOMES),
      note: z.string().max(5000).optional(),
      statusAfter: z.enum(REQUEST_STATUSES).optional(),
      expectedStatus: z.enum(REQUEST_STATUSES).optional(),
      followupAt: BerlinLocalDate.optional(),
      followupNote: z.string().max(2000).optional(),
    })
    .parse({
      id: formData.get("id"),
      outcome: formData.get("outcome"),
      note: optStr(formData, "note"),
      statusAfter: optStr(formData, "statusAfter"),
      expectedStatus: optStr(formData, "expectedStatus"),
      followupAt: optStr(formData, "followupAt"),
      followupNote: optStr(formData, "followupNote"),
    });
  if (input.followupAt && isPastBerlinDay(input.followupAt))
    throw new UserFacingError(FOLLOWUP_DATE_PAST);

  let appliedStatus: RequestStatus | null = null;

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    // Row lock: two people working the same Anfrage at once are serialized,
    // the second one sees the status the first one wrote (C-24).
    const [req] = await tx
      .select({
        status: schema.requests.status,
        firstContactedAt: schema.requests.firstContactedAt,
        pvsAppointmentId: schema.requests.pvsAppointmentId,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, input.id),
          eq(schema.requests.clinicId, session.clinicId)
        )
      )
      .limit(1)
      .for("update");
    if (!req) throw new UserFacingError("Diese Anfrage gibt es nicht mehr.");
    // The status flip was chosen on a page that showed `expectedStatus`; if
    // someone changed it since, refuse instead of overwriting their work.
    if (
      input.statusAfter &&
      input.expectedStatus &&
      input.expectedStatus !== req.status
    )
      throw new UserFacingError(STALE_MESSAGE);

    // 1. The call itself.
    await tx.insert(schema.requestActivities).values({
      requestId: input.id,
      actorId: session.userId,
      kind: "call",
      body: input.note ?? null,
      meta: { outcome: input.outcome },
    });

    // 2. Build the request patch: first-contact proof + optional status flip.
    const patch: Partial<typeof schema.requests.$inferInsert> = {};
    if (req.firstContactedAt === null) patch.firstContactedAt = new Date();

    if (input.statusAfter && input.statusAfter !== req.status) {
      // PVS owns linked leads — the status control is disabled client-side,
      // but defend the boundary server-side too.
      if (req.pvsAppointmentId !== null)
        throw new UserFacingError("Der Status wird von Ihrer PVS gesteuert.");
      const allowed = STATUS_TRANSITIONS[req.status as RequestStatus] ?? [];
      if (!allowed.includes(input.statusAfter))
        throw transitionError(req.status, input.statusAfter);

      patch.status = input.statusAfter;
      patch.statusSource = "manual";
      if (input.statusAfter === "gewonnen") patch.wonAt = new Date();
      appliedStatus = input.statusAfter;

      await tx.insert(schema.requestActivities).values({
        requestId: input.id,
        actorId: session.userId,
        kind: "status_change",
        meta: { from: req.status, to: input.statusAfter },
      });
    }

    if (Object.keys(patch).length > 0) {
      await tx
        .update(schema.requests)
        .set(patch)
        .where(
          and(
            eq(schema.requests.id, input.id),
            eq(schema.requests.clinicId, session.clinicId)
          )
        );
    }

    // 3. Optional Wiedervorlage.
    if (input.followupAt) {
      await tx.insert(schema.requestFollowups).values({
        clinicId: session.clinicId,
        requestId: input.id,
        dueAt: input.followupAt,
        note: input.followupNote ?? null,
        status: "pending",
        createdBy: session.userId,
      });
      await tx.insert(schema.requestActivities).values({
        requestId: input.id,
        actorId: session.userId,
        kind: "note",
        body: `Wiedervorlage für ${formatDateTime(input.followupAt)}${
          input.followupNote ? `: ${input.followupNote}` : ""
        }`,
      });
    }
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "request",
    entityId: input.id,
    diff: {
      call: input.outcome,
      ...(appliedStatus ? { status: appliedStatus } : {}),
      ...(input.followupAt ? { followupScheduled: true } : {}),
    },
  });

  revalidateLead(input.id, session.clinicId, session.userId);
}

/** Channels a sent message can be logged for (K-20). */
const MESSAGE_CHANNELS = ["email", "whatsapp"] as const;

/**
 * K-20: log an e-mail or WhatsApp message the team sent to the patient
 * outside the portal. Writes a `request_activities` row of kind
 * 'email' / 'whatsapp', which `firstAttemptAtSql` counts as a contact
 * attempt (Garantie-Anhang § 2), and stamps `firstContactedAt` like logCall.
 */
export async function logMessage(formData: FormData): Promise<ActionResult> {
  return toResult(() => logMessageImpl(formData));
}

async function logMessageImpl(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({
      id: IdSchema,
      channel: z.enum(MESSAGE_CHANNELS),
      note: z.string().max(5000).optional(),
    })
    .parse({
      id: formData.get("id"),
      channel: formData.get("channel"),
      note: optStr(formData, "note"),
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [req] = await tx
      .select({ firstContactedAt: schema.requests.firstContactedAt })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, input.id),
          eq(schema.requests.clinicId, session.clinicId)
        )
      )
      .limit(1)
      .for("update");
    if (!req) throw new UserFacingError("Diese Anfrage gibt es nicht mehr.");

    await tx.insert(schema.requestActivities).values({
      requestId: input.id,
      actorId: session.userId,
      kind: input.channel,
      body: input.note ?? null,
    });

    if (req.firstContactedAt === null) {
      await tx
        .update(schema.requests)
        .set({ firstContactedAt: new Date() })
        .where(
          and(
            eq(schema.requests.id, input.id),
            eq(schema.requests.clinicId, session.clinicId)
          )
        );
    }
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "request_activity",
    entityId: input.id,
    diff: { message: input.channel },
  });

  revalidateLead(input.id, session.clinicId, session.userId);
}

/** Add a free-text note to the Verlauf. Does not count as contact. */
export async function addNote(formData: FormData): Promise<ActionResult> {
  return toResult(() => addNoteImpl(formData));
}

async function addNoteImpl(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({ id: IdSchema, note: z.string().min(1).max(5000) })
    .parse({ id: formData.get("id"), note: formData.get("note") });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [req] = await tx
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, input.id),
          eq(schema.requests.clinicId, session.clinicId)
        )
      )
      .limit(1);
    if (!req) throw new UserFacingError("Diese Anfrage gibt es nicht mehr.");

    await tx.insert(schema.requestActivities).values({
      requestId: input.id,
      actorId: session.userId,
      kind: "note",
      body: input.note,
    });
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "request_activity",
    entityId: input.id,
    diff: { note: true },
  });

  revalidateLead(input.id, session.clinicId, session.userId);
}

/**
 * Change the lead status manually. Validated against STATUS_TRANSITIONS and
 * REJECTED for PVS-linked leads (the PVS owns those). Stamps firstContactedAt
 * when leaving `neu` and wonAt on → gewonnen; logs a status_change activity
 * with meta {from,to} (the shape the dashboard open-queue reconstruction reads).
 */
export async function changeStatus(formData: FormData): Promise<ActionResult> {
  return toResult(() => changeStatusImpl(formData));
}

async function changeStatusImpl(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({
      id: IdSchema,
      status: z.enum(REQUEST_STATUSES),
      expectedStatus: z.enum(REQUEST_STATUSES).optional(),
    })
    .parse({
      id: formData.get("id"),
      status: formData.get("status"),
      expectedStatus: optStr(formData, "expectedStatus"),
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [req] = await tx
      .select({
        status: schema.requests.status,
        firstContactedAt: schema.requests.firstContactedAt,
        pvsAppointmentId: schema.requests.pvsAppointmentId,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, input.id),
          eq(schema.requests.clinicId, session.clinicId)
        )
      )
      .limit(1)
      .for("update");
    if (!req) throw new UserFacingError("Diese Anfrage gibt es nicht mehr.");

    if (req.pvsAppointmentId !== null)
      throw new UserFacingError("Der Status wird von Ihrer PVS gesteuert.");
    if (input.status === req.status) return;
    // Chosen on a page that showed another status: someone changed it since.
    if (input.expectedStatus && input.expectedStatus !== req.status)
      throw new UserFacingError(STALE_MESSAGE);
    const allowed = STATUS_TRANSITIONS[req.status as RequestStatus] ?? [];
    if (!allowed.includes(input.status))
      throw transitionError(req.status, input.status);

    const patch: Partial<typeof schema.requests.$inferInsert> = {
      status: input.status,
      statusSource: "manual",
    };
    if (req.firstContactedAt === null && req.status === "neu")
      patch.firstContactedAt = new Date();
    if (input.status === "gewonnen") patch.wonAt = new Date();

    await tx
      .update(schema.requests)
      .set(patch)
      .where(
        and(
          eq(schema.requests.id, input.id),
          eq(schema.requests.clinicId, session.clinicId)
        )
      );

    await tx.insert(schema.requestActivities).values({
      requestId: input.id,
      actorId: session.userId,
      kind: "status_change",
      meta: { from: req.status, to: input.status },
    });
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "transition",
    entityKind: "request",
    entityId: input.id,
    diff: { to: input.status },
  });

  revalidateLead(input.id, session.clinicId, session.userId);
}

/** Schedule a Wiedervorlage (pending callback) + a Verlauf note. */
export async function scheduleFollowup(formData: FormData): Promise<ActionResult> {
  return toResult(() => scheduleFollowupImpl(formData));
}

async function scheduleFollowupImpl(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  if (!optStr(formData, "dueAt")) throw new UserFacingError(FOLLOWUP_DATE_MISSING);
  const input = z
    .object({
      id: IdSchema,
      dueAt: BerlinLocalDate,
      note: z.string().max(2000).optional(),
    })
    .parse({
      id: formData.get("id"),
      dueAt: String(formData.get("dueAt") ?? ""),
      note: optStr(formData, "note"),
    });
  // V7 3.9: today is fine, a past Berlin day is not.
  if (isPastBerlinDay(input.dueAt)) throw new UserFacingError(FOLLOWUP_DATE_PAST);

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [req] = await tx
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, input.id),
          eq(schema.requests.clinicId, session.clinicId)
        )
      )
      .limit(1);
    if (!req) throw new UserFacingError("Diese Anfrage gibt es nicht mehr.");

    await tx.insert(schema.requestFollowups).values({
      clinicId: session.clinicId,
      requestId: input.id,
      dueAt: input.dueAt,
      note: input.note ?? null,
      status: "pending",
      createdBy: session.userId,
    });
    await tx.insert(schema.requestActivities).values({
      requestId: input.id,
      actorId: session.userId,
      kind: "note",
      body: `Wiedervorlage für ${formatDateTime(input.dueAt)}${
        input.note ? `: ${input.note}` : ""
      }`,
    });
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "request_followup",
    entityId: input.id,
    diff: { dueAt: input.dueAt.toISOString() },
  });

  revalidateLead(input.id, session.clinicId, session.userId);
}

/** Resolve a pending Wiedervorlage: 'done' (erledigt) or 'cancelled' (abgebrochen). */
async function resolveFollowup(
  formData: FormData,
  status: "done" | "cancelled"
): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({ followupId: IdSchema, requestId: IdSchema })
    .parse({
      followupId: formData.get("followupId"),
      requestId: formData.get("requestId"),
    });

  const updated = await withClinicContext(session.clinicId, session.userId, (tx) =>
    tx
      .update(schema.requestFollowups)
      .set({ status, completedBy: session.userId, completedAt: new Date() })
      .where(
        and(
          eq(schema.requestFollowups.id, input.followupId),
          eq(schema.requestFollowups.clinicId, session.clinicId),
          eq(schema.requestFollowups.status, "pending")
        )
      )
      .returning({ id: schema.requestFollowups.id })
  );
  if (updated.length === 0) {
    revalidateLead(input.requestId, session.clinicId, session.userId);
    throw new UserFacingError(
      "Diese Wiedervorlage wurde bereits erledigt oder abgebrochen."
    );
  }

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "request_followup",
    entityId: input.followupId,
    diff: { status },
  });

  revalidateLead(input.requestId, session.clinicId, session.userId);
}

export async function completeFollowup(formData: FormData): Promise<ActionResult> {
  return toResult(() => resolveFollowup(formData, "done"));
}

export async function cancelFollowup(formData: FormData): Promise<ActionResult> {
  return toResult(() => resolveFollowup(formData, "cancelled"));
}

/**
 * Record that the person withdrew the separate consent to report this
 * inquiry and a later treatment to Meta and Google (migration 0077). The
 * purchase workers check consent at send time, so any not-yet-sent report
 * is stopped. Only touches an ACTIVE consent of the session's clinic.
 *
 * Audit log only, deliberately no call/email/whatsapp/status_change activity:
 * those count as a contact attempt for the 48-Werkstunden rule.
 */
export async function revokeAdsConsent(formData: FormData): Promise<ActionResult> {
  return toResult(() => revokeAdsConsentImpl(formData));
}

async function revokeAdsConsentImpl(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z.object({ id: IdSchema }).parse({ id: formData.get("id") });

  const revokedAt = new Date();
  const updated = await withClinicContext(
    session.clinicId,
    session.userId,
    async (tx) =>
      tx
        .update(schema.requests)
        .set({ adsConsentRevokedAt: revokedAt })
        .where(
          and(
            eq(schema.requests.id, input.id),
            eq(schema.requests.clinicId, session.clinicId),
            isNotNull(schema.requests.adsConsentAt),
            isNull(schema.requests.adsConsentRevokedAt)
          )
        )
        .returning({ id: schema.requests.id })
  );

  if (updated.length > 0) {
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "ads_consent_revoke",
      entityKind: "request",
      entityId: input.id,
      diff: { adsConsentRevokedAt: revokedAt.toISOString() },
    });
  }

  // Already revoked (e.g. by a colleague): the wanted state holds, so this
  // stays a success and the re-render shows "widerrufen am".
  revalidateLead(input.id, session.clinicId, session.userId);
}
