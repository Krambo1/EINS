"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { applyDefaultJourney } from "@/server/timeline-journey";
import { TIMELINE_STATUSES } from "@/lib/constants";

/**
 * Admin-side clinic mutations. All actions re-check admin session (defense
 * in depth — don't rely on the layout alone) and write audit rows.
 *
 * Input errors redirect back to the tab with ?fehler=… (G-20) instead of
 * throwing into the error boundary.
 */

function failTo(clinicId: string | undefined, tab: string, message: string): never {
  if (!clinicId) redirect("/admin/clinics");
  redirect(`/admin/clinics/${clinicId}?tab=${tab}&fehler=${encodeURIComponent(message)}`);
}

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `Eingabe ungültig (${i.path.join(".") || "Formular"}): ${i.message}` : "Eingabe ungültig.";
}

function formClinicId(formData: FormData, key = "clinicId"): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && z.string().uuid().safeParse(v).success ? v : undefined;
}

const UpdateClinicSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(2).max(200),
  legalName: z.string().min(2).max(200),
  hwgContactEmail: z.string().email().max(200).optional().or(z.literal("")),
  hwgContactName: z.string().max(200).optional().or(z.literal("")),
  defaultDoctorEmail: z.string().email().max(200).optional().or(z.literal("")),
});

export async function updateClinicAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = UpdateClinicSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    failTo(formClinicId(formData, "id"), "stammdaten", firstIssue(parsed.error));
  }
  const d = parsed.data;

  const [before] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, d.id))
    .limit(1);
  if (!before) redirect("/admin/clinics");

  await db
    .update(schema.clinics)
    .set({
      displayName: d.displayName,
      legalName: d.legalName,
      hwgContactEmail: d.hwgContactEmail || null,
      hwgContactName: d.hwgContactName || null,
      defaultDoctorEmail: d.defaultDoctorEmail || null,
    })
    .where(eq(schema.clinics.id, d.id));

  await writeAudit({
    clinicId: d.id,
    actorEmail: admin.email,
    action: "update",
    entityKind: "admin_clinic",
    entityId: d.id,
    diff: {
      displayName: { from: before.displayName, to: d.displayName },
    },
  });

  revalidateTag(`clinic:${d.id}`);
  revalidatePath(`/admin/clinics/${d.id}`);
  revalidatePath("/admin/clinics");
}

export async function archiveClinicAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));

  // G-05: archiving locks the Praxis out. One timestamp goes on the clinic,
  // on every still-active member (login + magic-link issuance check
  // clinic_users.archived_at) and their open sessions are revoked (session
  // validation checks both archived flags). Members archived by THIS action
  // carry the clinic's exact timestamp, which is how unarchive tells them
  // apart from members the owner had archived before.
  const archivedAt = new Date();
  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.clinics)
      .set({ archivedAt })
      .where(and(eq(schema.clinics.id, id), isNull(schema.clinics.archivedAt)))
      .returning({ id: schema.clinics.id });
    if (updated.length === 0) return null;

    const users = await tx
      .update(schema.clinicUsers)
      .set({ archivedAt })
      .where(
        and(eq(schema.clinicUsers.clinicId, id), isNull(schema.clinicUsers.archivedAt))
      )
      .returning({ id: schema.clinicUsers.id });

    let sessionsRevoked = 0;
    if (users.length) {
      const revoked = await tx
        .update(schema.sessions)
        .set({ revokedAt: archivedAt })
        .where(
          and(
            inArray(
              schema.sessions.userId,
              users.map((u) => u.id)
            ),
            isNull(schema.sessions.revokedAt)
          )
        )
        .returning({ id: schema.sessions.id });
      sessionsRevoked = revoked.length;
    }
    return { users: users.length, sessionsRevoked };
  });

  if (result) {
    await writeAudit({
      clinicId: id,
      actorEmail: admin.email,
      action: "delete",
      entityKind: "admin_clinic",
      entityId: id,
      diff: { archived: true, usersArchived: result.users, sessionsRevoked: result.sessionsRevoked },
    });
  }

  revalidateTag(`clinic:${id}`);
  revalidatePath("/admin/clinics");
  redirect("/admin/clinics");
}

// ---------------------------------------------------------------
// Clinic timeline ("Fortschritt") — admin CRUD
// ---------------------------------------------------------------

const TimelineStatusSchema = z.enum(TIMELINE_STATUSES);

const TimelineCreateSchema = z.object({
  clinicId: z.string().uuid(),
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional().or(z.literal("")),
  eventDate: z.string().min(1),
  status: TimelineStatusSchema,
});

// eventDate optional on update (G-17): the default journey uses relative
// phases (event_date NULL); editing the status must not force a made-up date.
const TimelineUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional().or(z.literal("")),
  eventDate: z.string().optional().or(z.literal("")),
  status: TimelineStatusSchema,
});

function parseEventDate(input: string): Date | null {
  // Accept yyyy-mm-dd from <input type="date"> as well as full ISO strings.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T12:00:00Z`)
    : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createTimelineEntryAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = TimelineCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    failTo(formClinicId(formData), "fortschritt", firstIssue(parsed.error));
  }
  const d = parsed.data;
  const eventDate = parseEventDate(d.eventDate);
  if (!eventDate) failTo(d.clinicId, "fortschritt", "Datum ist ungültig.");

  const [row] = await db
    .insert(schema.clinicTimelineEntries)
    .values({
      clinicId: d.clinicId,
      title: d.title,
      description: d.description?.length ? d.description : null,
      eventDate,
      status: d.status,
      createdByEmail: admin.email,
    })
    .returning({ id: schema.clinicTimelineEntries.id });

  await writeAudit({
    clinicId: d.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "clinic_timeline_entry",
    entityId: row?.id,
    diff: {
      title: d.title,
      status: d.status,
      eventDate: eventDate.toISOString(),
    },
  });

  revalidateTag(`timeline:${d.clinicId}`);
  revalidatePath(`/admin/clinics/${d.clinicId}`);
  revalidatePath("/fortschritt");
}

export async function updateTimelineEntryAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = TimelineUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(`/admin/clinics?fehler=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  const d = parsed.data;

  const [before] = await db
    .select()
    .from(schema.clinicTimelineEntries)
    .where(eq(schema.clinicTimelineEntries.id, d.id))
    .limit(1);
  if (!before) redirect("/admin/clinics");

  // Empty date keeps the entry undated (relative phase); a typed date wins.
  const eventDate = d.eventDate && d.eventDate.length > 0 ? parseEventDate(d.eventDate) : null;
  if (d.eventDate && d.eventDate.length > 0 && !eventDate) {
    failTo(before.clinicId, "fortschritt", "Datum ist ungültig.");
  }

  await db
    .update(schema.clinicTimelineEntries)
    .set({
      title: d.title,
      description: d.description?.length ? d.description : null,
      eventDate,
      status: d.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.clinicTimelineEntries.id, d.id));

  await writeAudit({
    clinicId: before.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "clinic_timeline_entry",
    entityId: d.id,
    diff: {
      title: { from: before.title, to: d.title },
      status: { from: before.status, to: d.status },
      eventDate: {
        from: before.eventDate ? before.eventDate.toISOString() : null,
        to: eventDate ? eventDate.toISOString() : null,
      },
    },
  });

  revalidateTag(`timeline:${before.clinicId}`);
  revalidatePath(`/admin/clinics/${before.clinicId}`);
  revalidatePath("/fortschritt");
}

export async function deleteTimelineEntryAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));

  const [before] = await db
    .select()
    .from(schema.clinicTimelineEntries)
    .where(eq(schema.clinicTimelineEntries.id, id))
    .limit(1);
  if (!before) return;

  await db
    .delete(schema.clinicTimelineEntries)
    .where(eq(schema.clinicTimelineEntries.id, id));

  await writeAudit({
    clinicId: before.clinicId,
    actorEmail: admin.email,
    action: "delete",
    entityKind: "clinic_timeline_entry",
    entityId: id,
    diff: { title: before.title, status: before.status },
  });

  revalidateTag(`timeline:${before.clinicId}`);
  revalidatePath(`/admin/clinics/${before.clinicId}`);
  revalidatePath("/fortschritt");
}

/**
 * Seed the central default-journey template into this clinic's Fortschritt feed.
 * Idempotent (see {@link applyDefaultJourney}): a no-op when the clinic already
 * has entries, so a double-click never duplicates. Surfaced in the admin tab
 * only when a clinic is still empty.
 */
export async function seedDefaultJourneyAction(formData: FormData) {
  const admin = await requireAdmin();
  const clinicId = z.string().uuid().parse(formData.get("clinicId"));

  const { seeded } = await applyDefaultJourney(clinicId);

  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "clinic_timeline_entry",
    diff: { seededDefaultJourney: seeded },
  });

  revalidateTag(`timeline:${clinicId}`);
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/fortschritt");
}

// ---------------------------------------------------------------
// Asset-Liefer-Checkliste — EINS confirms delivered items ('geprueft').
// The clinic side only ever sets 'geliefert'/'entfaellt'; this is the second
// stage. Runs on the superuser connection (cross-tenant by design).
// ---------------------------------------------------------------

const VerifyChecklistSchema = z.object({
  clinicId: z.string().uuid(),
  itemId: z.string().min(1).max(8),
  verified: z.enum(["1", "0"]),
});

export async function setChecklistItemVerifiedAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = VerifyChecklistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    failTo(formClinicId(formData), "checkliste", firstIssue(parsed.error));
  }
  const { clinicId, itemId } = parsed.data;
  const verified = parsed.data.verified === "1";

  const [before] = await db
    .select()
    .from(schema.checklistItems)
    .where(
      and(
        eq(schema.checklistItems.clinicId, clinicId),
        eq(schema.checklistItems.itemId, itemId)
      )
    )
    .limit(1);
  if (!before) failTo(clinicId, "checkliste", "Checklisten-Punkt nicht gefunden.");

  // Only a delivered item can be confirmed (or a re-confirm of an already
  // verified one). Don't let EINS "verify" something the clinic hasn't sent.
  if (
    verified &&
    before.status !== "geliefert" &&
    before.status !== "geprueft"
  ) {
    failTo(clinicId, "checkliste", "Nur gelieferte Punkte lassen sich bestätigen.");
  }

  await db
    .update(schema.checklistItems)
    .set(
      verified
        ? {
            status: "geprueft",
            verifiedAt: new Date(),
            verifiedBy: admin.email,
            updatedAt: new Date(),
          }
        : {
            status: "geliefert",
            verifiedAt: null,
            verifiedBy: null,
            updatedAt: new Date(),
          }
    )
    .where(eq(schema.checklistItems.id, before.id));

  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: verified ? "approve" : "reject",
    entityKind: "checklist_item",
    diff: { itemId, verified },
  });

  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/onboarding/checkliste");
}

export async function unarchiveClinicAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));

  // Restores exactly the members the archive action archived (same
  // timestamp); members archived individually before stay archived.
  const result = await db.transaction(async (tx) => {
    const [clinic] = await tx
      .select({ archivedAt: schema.clinics.archivedAt })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, id))
      .for("update")
      .limit(1);
    if (!clinic?.archivedAt) return null;

    const users = await tx
      .update(schema.clinicUsers)
      .set({ archivedAt: null })
      .where(
        and(
          eq(schema.clinicUsers.clinicId, id),
          eq(schema.clinicUsers.archivedAt, clinic.archivedAt)
        )
      )
      .returning({ id: schema.clinicUsers.id });

    await tx
      .update(schema.clinics)
      .set({ archivedAt: null })
      .where(eq(schema.clinics.id, id));
    return { users: users.length };
  });

  if (result) {
    await writeAudit({
      clinicId: id,
      actorEmail: admin.email,
      action: "update",
      entityKind: "admin_clinic",
      entityId: id,
      diff: { archived: false, usersRestored: result.users },
    });
  }

  revalidateTag(`clinic:${id}`);
  revalidatePath(`/admin/clinics/${id}`);
  revalidatePath("/admin/clinics");
}


// ---------------------------------------------------------------
// Client uploads ("Dateien an EINS") — EINS-side read receipt.
// ---------------------------------------------------------------

const SeenUploadSchema = z.object({
  clinicId: z.string().uuid(),
  uploadId: z.string().uuid(),
  seen: z.enum(["0", "1"]),
});

export async function setClientUploadSeenAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = SeenUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    failTo(formClinicId(formData), "dateien", firstIssue(parsed.error));
  }
  const { clinicId, uploadId } = parsed.data;
  const seen = parsed.data.seen === "1";

  const [before] = await db
    .select()
    .from(schema.clientUploads)
    .where(
      and(
        eq(schema.clientUploads.id, uploadId),
        eq(schema.clientUploads.clinicId, clinicId)
      )
    )
    .limit(1);
  if (!before) failTo(clinicId, "dateien", "Datei nicht gefunden.");

  await db
    .update(schema.clientUploads)
    .set(
      seen
        ? { seenAt: new Date(), seenBy: admin.email }
        : { seenAt: null, seenBy: null }
    )
    .where(eq(schema.clientUploads.id, before.id));

  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: seen ? "approve" : "reject",
    entityKind: "client_upload",
    entityId: uploadId,
    diff: { filename: before.originalFilename, seen },
  });

  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/dateien");
}

/** Mark every unseen upload of the clinic as seen — one click after review. */
export async function markAllClientUploadsSeenAction(formData: FormData) {
  const admin = await requireAdmin();
  const clinicId = z.string().uuid().parse(formData.get("clinicId"));

  await db
    .update(schema.clientUploads)
    .set({ seenAt: new Date(), seenBy: admin.email })
    .where(
      and(
        eq(schema.clientUploads.clinicId, clinicId),
        isNull(schema.clientUploads.seenAt)
      )
    );

  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: "approve",
    entityKind: "client_upload",
    diff: { allSeen: true },
  });

  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/dateien");
}
