"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { withClinicContext, db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import {
  STATUS_TRANSITIONS,
  type RequestStatus,
  REQUEST_STATUS_LABELS,
} from "@/lib/constants";
import { can, ForbiddenError } from "@/lib/roles";

const IdParam = z.string().uuid();

/** Add a free-text note to a request. */
export async function addNoteAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    throw new ForbiddenError("requests.update");
  }
  const requestId = IdParam.parse(formData.get("requestId"));
  const body = z.string().min(1).max(5000).parse(formData.get("body"));

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx.insert(schema.requestActivities).values({
      requestId,
      actorId: session.userId,
      kind: "note",
      body,
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "request_activity",
    entityId: requestId,
    diff: { kind: "note" },
  });
  revalidatePath(`/anfragen/${requestId}`);
}

/** Log a phone call on this request. Also marks first_contacted_at if unset. */
export async function logCallAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    throw new ForbiddenError("requests.update");
  }
  const requestId = IdParam.parse(formData.get("requestId"));
  const body = z.string().max(5000).optional().parse(formData.get("body") ?? undefined);

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx.insert(schema.requestActivities).values({
      requestId,
      actorId: session.userId,
      kind: "call",
      body: body ?? "Anruf protokolliert",
    });
    // First contact stamp — only if still null.
    await tx
      .update(schema.requests)
      .set({ firstContactedAt: new Date() })
      .where(
        and(
          eq(schema.requests.id, requestId),
          eq(schema.requests.clinicId, session.clinicId)
        )
      );
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "request_activity",
    entityId: requestId,
    diff: { kind: "call" },
  });
  revalidatePath(`/anfragen/${requestId}`);
}

/** Move the request through its status machine. */
export async function changeStatusAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    throw new ForbiddenError("requests.update");
  }
  const requestId = IdParam.parse(formData.get("requestId"));
  const newStatus = z
    .enum([
      "neu",
      "qualifiziert",
      "termin_vereinbart",
      "beratung_erschienen",
      "gewonnen",
      "verloren",
      "spam",
    ])
    .parse(formData.get("status"));

  const revenueRaw = formData.get("revenue");
  const revenue =
    revenueRaw !== null && revenueRaw !== ""
      ? Number(z.string().parse(revenueRaw).replace(",", "."))
      : null;

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [cur] = await tx
      .select({ status: schema.requests.status })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);
    if (!cur) throw new Error("Anfrage nicht gefunden");

    const allowed = STATUS_TRANSITIONS[cur.status as RequestStatus];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Übergang nicht erlaubt: ${REQUEST_STATUS_LABELS[cur.status as RequestStatus]} → ${REQUEST_STATUS_LABELS[newStatus]}`
      );
    }

    await tx
      .update(schema.requests)
      .set({
        status: newStatus,
        wonAt: newStatus === "gewonnen" ? new Date() : undefined,
        convertedRevenueEur:
          newStatus === "gewonnen" && revenue !== null ? String(revenue) : undefined,
      })
      .where(eq(schema.requests.id, requestId));

    await tx.insert(schema.requestActivities).values({
      requestId,
      actorId: session.userId,
      kind: "status_change",
      body: `${REQUEST_STATUS_LABELS[cur.status as RequestStatus]} → ${REQUEST_STATUS_LABELS[newStatus]}`,
      meta: { from: cur.status, to: newStatus, revenue },
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "transition",
    entityKind: "request",
    entityId: requestId,
    diff: { status: newStatus, revenue },
  });
  revalidatePath(`/anfragen/${requestId}`);
}

/** Categorize the request under a treatment (or unset). */
export async function setTreatmentAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    throw new ForbiddenError("requests.update");
  }
  const requestId = IdParam.parse(formData.get("requestId"));
  const treatmentRaw = formData.get("treatmentId");
  const treatmentId = treatmentRaw
    ? z.string().uuid().parse(treatmentRaw)
    : null;

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    if (treatmentId) {
      const [t] = await tx
        .select({ id: schema.treatments.id })
        .from(schema.treatments)
        .where(
          and(
            eq(schema.treatments.id, treatmentId),
            eq(schema.treatments.clinicId, session.clinicId)
          )
        )
        .limit(1);
      if (!t) throw new Error("Behandlung nicht gefunden.");
    }
    await tx
      .update(schema.requests)
      .set({ treatmentId })
      .where(eq(schema.requests.id, requestId));
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "request",
    entityId: requestId,
    diff: { treatmentId },
  });
  revalidatePath(`/anfragen/${requestId}`);
}

/** Schedule a recall / followup / review-request for this request. */
export async function scheduleRecallAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    throw new ForbiddenError("requests.update");
  }
  const requestId = IdParam.parse(formData.get("requestId"));
  const scheduledFor = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum (YYYY-MM-DD) erwartet")
    .parse(formData.get("scheduledFor"));
  const kind = z
    .enum(["recall", "followup", "review_request"])
    .parse(formData.get("kind"));
  const note = z.string().max(500).optional().parse(formData.get("note") ?? undefined);

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [req] = await tx
      .select({ patientId: schema.requests.patientId })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);
    if (!req) throw new Error("Anfrage nicht gefunden.");

    await tx.insert(schema.requestRecalls).values({
      clinicId: session.clinicId,
      requestId,
      patientId: req.patientId,
      scheduledFor,
      kind,
      status: "pending",
      note: note ?? null,
      createdBy: session.userId,
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entityKind: "request_recall",
    entityId: requestId,
    diff: { kind, scheduledFor },
  });
  revalidatePath(`/anfragen/${requestId}`);
}

/** Re-assign a request to a team member (or unassign). */
export async function assignAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    throw new ForbiddenError("requests.update");
  }
  const requestId = IdParam.parse(formData.get("requestId"));
  const assigneeRaw = formData.get("assigneeId");
  const assigneeId = assigneeRaw
    ? z.string().uuid().parse(assigneeRaw)
    : null;

  // Validate the assignee is in the same clinic — defence in depth on top of RLS.
  if (assigneeId) {
    const [u] = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.id, assigneeId),
          eq(schema.clinicUsers.clinicId, session.clinicId)
        )
      )
      .limit(1);
    if (!u) throw new Error("Zuständige Person nicht gefunden.");
  }

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.requests)
      .set({ assignedTo: assigneeId })
      .where(eq(schema.requests.id, requestId));
    await tx.insert(schema.requestActivities).values({
      requestId,
      actorId: session.userId,
      kind: "assignment",
      body: assigneeId ? "Zuweisung aktualisiert" : "Zuweisung entfernt",
      meta: { assigneeId },
    });
  });
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "assign",
    entityKind: "request",
    entityId: requestId,
    diff: { assigneeId },
  });
  revalidatePath(`/anfragen/${requestId}`);
}
