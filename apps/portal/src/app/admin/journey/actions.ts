"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { TIMELINE_STATUSES } from "@/lib/constants";

/**
 * Admin CRUD for the central default-journey template (timeline_default_steps).
 *
 * Editing the template only affects FUTURE seedings (new clinics, or empty
 * clinics seeded via the "Standard-Journey einsetzen" button). Already-seeded
 * clinics carry their own copies and are tweaked per clinic in the Fortschritt
 * admin tab, so these actions deliberately do NOT revalidate any clinic-facing
 * `/fortschritt` page. All run on the superuser `db` (the template has no
 * eins_app grant) and re-check admin + write audit.
 */

const StatusSchema = z.enum(TIMELINE_STATUSES);
const ActiveSchema = z.enum(["1", "0"]);

const StepFields = {
  sortOrder: z.coerce.number().int().min(0).max(100000),
  phaseLabel: z.string().max(80).optional().or(z.literal("")),
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional().or(z.literal("")),
  defaultStatus: StatusSchema,
  isActive: ActiveSchema,
};

const CreateStepSchema = z.object(StepFields);
const UpdateStepSchema = z.object({ id: z.string().uuid(), ...StepFields });

export async function createDefaultStepAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = CreateStepSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const d = parsed.data;

  const [row] = await db
    .insert(schema.timelineDefaultSteps)
    .values({
      sortOrder: d.sortOrder,
      phaseLabel: d.phaseLabel?.length ? d.phaseLabel : null,
      title: d.title,
      description: d.description?.length ? d.description : null,
      defaultStatus: d.defaultStatus,
      isActive: d.isActive === "1",
    })
    .returning({ id: schema.timelineDefaultSteps.id });

  await writeAudit({
    actorEmail: admin.email,
    action: "create",
    entityKind: "timeline_default_step",
    entityId: row?.id,
    diff: { title: d.title, sortOrder: d.sortOrder, status: d.defaultStatus },
  });

  revalidatePath("/admin/journey");
}

export async function updateDefaultStepAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = UpdateStepSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const d = parsed.data;

  const [before] = await db
    .select()
    .from(schema.timelineDefaultSteps)
    .where(eq(schema.timelineDefaultSteps.id, d.id))
    .limit(1);
  if (!before) throw new Error("default_step_not_found");

  await db
    .update(schema.timelineDefaultSteps)
    .set({
      sortOrder: d.sortOrder,
      phaseLabel: d.phaseLabel?.length ? d.phaseLabel : null,
      title: d.title,
      description: d.description?.length ? d.description : null,
      defaultStatus: d.defaultStatus,
      isActive: d.isActive === "1",
      updatedAt: new Date(),
    })
    .where(eq(schema.timelineDefaultSteps.id, d.id));

  await writeAudit({
    actorEmail: admin.email,
    action: "update",
    entityKind: "timeline_default_step",
    entityId: d.id,
    diff: {
      title: { from: before.title, to: d.title },
      sortOrder: { from: before.sortOrder, to: d.sortOrder },
      status: { from: before.defaultStatus, to: d.defaultStatus },
      isActive: { from: before.isActive, to: d.isActive === "1" },
    },
  });

  revalidatePath("/admin/journey");
}

export async function deleteDefaultStepAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));

  const [before] = await db
    .select()
    .from(schema.timelineDefaultSteps)
    .where(eq(schema.timelineDefaultSteps.id, id))
    .limit(1);
  if (!before) return;

  await db
    .delete(schema.timelineDefaultSteps)
    .where(eq(schema.timelineDefaultSteps.id, id));

  await writeAudit({
    actorEmail: admin.email,
    action: "delete",
    entityKind: "timeline_default_step",
    entityId: id,
    diff: { title: before.title, sortOrder: before.sortOrder },
  });

  revalidatePath("/admin/journey");
}
