"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { TIMELINE_STATUSES } from "@/lib/constants";

/**
 * Admin-side clinic mutations. All actions re-check admin session (defense
 * in depth — don't rely on the layout alone) and write audit rows.
 */

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
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const d = parsed.data;

  const [before] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, d.id))
    .limit(1);
  if (!before) throw new Error("clinic_not_found");

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

  await db
    .update(schema.clinics)
    .set({ archivedAt: new Date() })
    .where(eq(schema.clinics.id, id));

  await writeAudit({
    clinicId: id,
    actorEmail: admin.email,
    action: "delete",
    entityKind: "admin_clinic",
    entityId: id,
    diff: { archived: true },
  });

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

const TimelineUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional().or(z.literal("")),
  eventDate: z.string().min(1),
  status: TimelineStatusSchema,
});

function parseEventDate(input: string): Date {
  // Accept yyyy-mm-dd from <input type="date"> as well as full ISO strings.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T12:00:00Z`)
    : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error("invalid_event_date");
  return d;
}

export async function createTimelineEntryAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = TimelineCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const d = parsed.data;
  const eventDate = parseEventDate(d.eventDate);

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
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const d = parsed.data;
  const eventDate = parseEventDate(d.eventDate);

  const [before] = await db
    .select()
    .from(schema.clinicTimelineEntries)
    .where(eq(schema.clinicTimelineEntries.id, d.id))
    .limit(1);
  if (!before) throw new Error("timeline_entry_not_found");

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
        from: before.eventDate.toISOString(),
        to: eventDate.toISOString(),
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

export async function unarchiveClinicAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));

  await db
    .update(schema.clinics)
    .set({ archivedAt: null })
    .where(eq(schema.clinics.id, id));

  await writeAudit({
    clinicId: id,
    actorEmail: admin.email,
    action: "update",
    entityKind: "admin_clinic",
    entityId: id,
    diff: { archived: false },
  });

  revalidateTag(`clinic:${id}`);
  revalidatePath(`/admin/clinics/${id}`);
  revalidatePath("/admin/clinics");
}

