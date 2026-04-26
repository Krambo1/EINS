"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { PLAN_TIERS } from "@/lib/constants";
import { writeAudit } from "@/server/audit";

/**
 * Admin-side clinic mutations. All actions re-check admin session (defense
 * in depth — don't rely on the layout alone) and write audit rows.
 */

const UpdateClinicSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(2).max(200),
  legalName: z.string().min(2).max(200),
  plan: z.enum(PLAN_TIERS),
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
      plan: d.plan,
      planStartedAt:
        before.plan === d.plan ? before.planStartedAt : new Date(),
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
      plan: { from: before.plan, to: d.plan },
      displayName: { from: before.displayName, to: d.displayName },
    },
  });

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

  revalidatePath("/admin/clinics");
  redirect("/admin/clinics");
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

  revalidatePath(`/admin/clinics/${id}`);
  revalidatePath("/admin/clinics");
}

const PlanOverrideSchema = z.object({
  id: z.string().uuid(),
  plan: z.enum(PLAN_TIERS),
  reason: z.string().min(3).max(500),
});

/**
 * Manual plan override — bypasses the upgrade-request flow for emergencies.
 * Requires a reason which is written to the audit log so the manual change
 * is distinguishable from upgrade-request approval.
 */
export async function overrideClinicPlanAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = PlanOverrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const { id, plan, reason } = parsed.data;

  const [before] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, id))
    .limit(1);
  if (!before) throw new Error("clinic_not_found");

  await db
    .update(schema.clinics)
    .set({ plan, planStartedAt: new Date() })
    .where(eq(schema.clinics.id, id));

  await writeAudit({
    clinicId: id,
    actorEmail: admin.email,
    action: "plan_manual_override",
    entityKind: "admin_clinic",
    entityId: id,
    diff: { plan: { from: before.plan, to: plan }, reason },
  });

  revalidatePath(`/admin/clinics/${id}`);
  revalidatePath("/admin/clinics");
  revalidatePath("/admin");
}
