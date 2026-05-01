"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { enqueueEmail } from "@/server/jobs";
import { ANIMATION_STATES } from "@/lib/constants";

/**
 * Progress an animation instance along its lifecycle. Going to "ready"
 * also stamps a deliveredAt so the clinic can see when it was finalized,
 * and emails the requester (if any).
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

  const nowReady = status === "ready";
  await db
    .update(schema.animationInstances)
    .set({
      status,
      storageKeyCustomized:
        storageKeyCustomized !== undefined
          ? storageKeyCustomized || null
          : row.instance.storageKeyCustomized,
      deliveredAt: nowReady ? new Date() : row.instance.deliveredAt,
    })
    .where(eq(schema.animationInstances.id, id));

  await writeAudit({
    clinicId: row.instance.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "animation_instance",
    entityId: id,
    diff: { status: { from: row.instance.status, to: status } },
  });

  if (nowReady && row.instance.requestedBy) {
    const [requester] = await db
      .select()
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, row.instance.requestedBy))
      .limit(1);
    if (requester?.email) {
      await enqueueEmail({
        to: requester.email,
        subject: "Ihre angepasste Animation ist bereit",
        text: `Hallo${requester.fullName ? " " + requester.fullName : ""},\n\nIhre angeforderte Animation „${row.library?.title ?? ""}" ist fertig und steht unter /animationen im Portal bereit.\n\nViele Grüße\nEINS Visuals`,
      });
    }
  }

  revalidatePath("/admin/operations");
  revalidatePath("/admin");
}
