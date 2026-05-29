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
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import {
  CALL_OUTCOMES,
  REQUEST_STATUSES,
  STATUS_TRANSITIONS,
  type RequestStatus,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";

const IdSchema = z.string().uuid();

/** Read an optional, non-empty FormData string (empty string → undefined). */
function optStr(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function revalidateLead(id: string) {
  revalidatePath(`/anfragen/${id}`);
  revalidatePath("/anfragen");
  revalidatePath("/dashboard");
}

/**
 * Log a phone-call attempt. Captures the per-call outcome and, in the same
 * transaction, optionally flips the lead status and schedules a Wiedervorlage
 * — because the real workflow ("didn't pick up → mark Nicht erreicht →
 * Rückruf morgen 14:00") is a single submit. Stamps `firstContactedAt` on the
 * first call (the response-time proof).
 */
export async function logCall(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({
      id: IdSchema,
      outcome: z.enum(CALL_OUTCOMES),
      note: z.string().max(5000).optional(),
      statusAfter: z.enum(REQUEST_STATUSES).optional(),
      followupAt: z.coerce.date().optional(),
      followupNote: z.string().max(2000).optional(),
    })
    .parse({
      id: formData.get("id"),
      outcome: formData.get("outcome"),
      note: optStr(formData, "note"),
      statusAfter: optStr(formData, "statusAfter"),
      followupAt: optStr(formData, "followupAt"),
      followupNote: optStr(formData, "followupNote"),
    });

  let appliedStatus: RequestStatus | null = null;

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
      .limit(1);
    if (!req) throw new Error("Anfrage nicht gefunden.");

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
        throw new Error("Status wird von Ihrer PVS gesteuert.");
      const allowed = STATUS_TRANSITIONS[req.status as RequestStatus] ?? [];
      if (!allowed.includes(input.statusAfter))
        throw new Error(`Statuswechsel ${req.status} → ${input.statusAfter} nicht erlaubt.`);

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

  revalidateLead(input.id);
}

/** Add a free-text note to the Verlauf. Does not count as contact. */
export async function addNote(formData: FormData) {
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
    if (!req) throw new Error("Anfrage nicht gefunden.");

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

  revalidateLead(input.id);
}

/**
 * Change the lead status manually. Validated against STATUS_TRANSITIONS and
 * REJECTED for PVS-linked leads (the PVS owns those). Stamps firstContactedAt
 * when leaving `neu` and wonAt on → gewonnen; logs a status_change activity
 * with meta {from,to} (the shape the dashboard open-queue reconstruction reads).
 */
export async function changeStatus(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({ id: IdSchema, status: z.enum(REQUEST_STATUSES) })
    .parse({ id: formData.get("id"), status: formData.get("status") });

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
      .limit(1);
    if (!req) throw new Error("Anfrage nicht gefunden.");

    if (req.pvsAppointmentId !== null)
      throw new Error("Status wird von Ihrer PVS gesteuert.");
    if (input.status === req.status) return;
    const allowed = STATUS_TRANSITIONS[req.status as RequestStatus] ?? [];
    if (!allowed.includes(input.status))
      throw new Error(`Statuswechsel ${req.status} → ${input.status} nicht erlaubt.`);

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

  revalidateLead(input.id);
}

/** Schedule a Wiedervorlage (pending callback) + a Verlauf note. */
export async function scheduleFollowup(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({
      id: IdSchema,
      dueAt: z.coerce.date(),
      note: z.string().max(2000).optional(),
    })
    .parse({
      id: formData.get("id"),
      dueAt: formData.get("dueAt"),
      note: optStr(formData, "note"),
    });

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
    if (!req) throw new Error("Anfrage nicht gefunden.");

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

  revalidateLead(input.id);
}

/** Resolve a pending Wiedervorlage: 'done' (erledigt) or 'cancelled' (abgebrochen). */
async function resolveFollowup(formData: FormData, status: "done" | "cancelled") {
  const session = await requireSession();
  if (!can(session.role, "requests.update"))
    throw new ForbiddenError("requests.update");

  const input = z
    .object({ followupId: IdSchema, requestId: IdSchema })
    .parse({
      followupId: formData.get("followupId"),
      requestId: formData.get("requestId"),
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.requestFollowups)
      .set({ status, completedBy: session.userId, completedAt: new Date() })
      .where(
        and(
          eq(schema.requestFollowups.id, input.followupId),
          eq(schema.requestFollowups.clinicId, session.clinicId),
          eq(schema.requestFollowups.status, "pending")
        )
      );
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "request_followup",
    entityId: input.followupId,
    diff: { status },
  });

  revalidateLead(input.requestId);
}

export async function completeFollowup(formData: FormData) {
  return resolveFollowup(formData, "done");
}

export async function cancelFollowup(formData: FormData) {
  return resolveFollowup(formData, "cancelled");
}
