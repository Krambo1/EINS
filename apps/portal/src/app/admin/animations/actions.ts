"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { ANIMATION_STATES } from "@/lib/constants";

/**
 * Progress an animation instance along its lifecycle. Going to "ready"
 * also stamps a deliveredAt. No e-mail to the Praxis: the portal no longer
 * shows animations (Karam, 2026-10-30), EINS uses them inside posts.
 */
const UpdateStateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(ANIMATION_STATES),
  storageKeyCustomized: z.string().max(1024).optional().or(z.literal("")),
});

export async function updateAnimationStateAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = UpdateStateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const { id, status, storageKeyCustomized } = parsed.data;

  const [row] = await db
    .select({
      instance: schema.animationInstances,
      library: schema.animationLibrary,
    })
    .from(schema.animationInstances)
    .leftJoin(
      schema.animationLibrary,
      eq(schema.animationLibrary.id, schema.animationInstances.libraryId)
    )
    .where(eq(schema.animationInstances.id, id))
    .limit(1);
  if (!row) throw new Error("animation_not_found");

  // G-11: the customized file must exist and belong to this Praxis.
  const newKey =
    storageKeyCustomized !== undefined
      ? storageKeyCustomized.trim() || null
      : row.instance.storageKeyCustomized;
  if (newKey && newKey !== row.instance.storageKeyCustomized) {
    if (newKey.includes("..") || !newKey.startsWith(`${row.instance.clinicId}/`)) {
      throw new Error("storage_key_outside_clinic_prefix");
    }
    const { getStorage } = await import("@/server/storage");
    const head = await getStorage().head(newKey);
    if (!head) throw new Error("storage_key_not_found");
  }

  // Only a real transition into "ready" stamps deliveredAt; a second click
  // on "ready" (or a double submit) changes nothing (G-11).
  const becameReady = status === "ready" && row.instance.status !== "ready";
  const deliveredAt = becameReady ? new Date() : row.instance.deliveredAt;
  await db
    .update(schema.animationInstances)
    .set({ status, storageKeyCustomized: newKey, deliveredAt })
    .where(
      becameReady
        ? and(
            eq(schema.animationInstances.id, id),
            ne(schema.animationInstances.status, "ready")
          )
        : eq(schema.animationInstances.id, id)
    );

  await writeAudit({
    clinicId: row.instance.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "animation_instance",
    entityId: id,
    diff: { status: { from: row.instance.status, to: status } },
  });

  revalidatePath("/admin/operations");
  revalidatePath("/admin");
}
