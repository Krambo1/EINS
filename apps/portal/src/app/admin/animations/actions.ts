"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { sendEmailOnce } from "@/server/email-once";
import { env } from "@/lib/env";
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

  // G-11: the customized file must exist and belong to this Praxis, otherwise
  // the Praxis gets a dead download behind the "bereit" mail.
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

  // Only a real transition into "ready" stamps deliveredAt and mails; a
  // second click on "ready" (or a double submit) changes nothing (G-11).
  const becameReady = status === "ready" && row.instance.status !== "ready";
  const deliveredAt = becameReady ? new Date() : row.instance.deliveredAt;
  const updated = await db
    .update(schema.animationInstances)
    .set({ status, storageKeyCustomized: newKey, deliveredAt })
    .where(
      becameReady
        ? and(
            eq(schema.animationInstances.id, id),
            ne(schema.animationInstances.status, "ready")
          )
        : eq(schema.animationInstances.id, id)
    )
    .returning({ id: schema.animationInstances.id });
  // A concurrent submit already moved it to ready: nothing more to do.
  const mailNow = becameReady && updated.length > 0;

  await writeAudit({
    clinicId: row.instance.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "animation_instance",
    entityId: id,
    diff: { status: { from: row.instance.status, to: status } },
  });

  if (mailNow && row.instance.requestedBy && deliveredAt) {
    const [requester] = await db
      .select()
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, row.instance.requestedBy))
      .limit(1);
    if (requester?.email && !requester.archivedAt) {
      // Inline, not via the pg-boss queue (worker is off in production).
      // The key is per transition, so a later re-delivery mails again but a
      // retry of the same one never does.
      const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/medien?kind=animationen`;
      try {
        await sendEmailOnce({
          key: `animation-ready/${id}/${deliveredAt.getTime()}`,
          clinicId: row.instance.clinicId,
          klass: "transactional",
          to: requester.email,
          subject: "Ihre angepasste Animation ist bereit",
          text: `Guten Tag${requester.fullName ? " " + requester.fullName : ""},\n\nIhre angeforderte Animation „${row.library?.title ?? ""}" ist fertig und steht im Portal unter Medien bereit:\n${link}\n\nViele Grüße\nEINS`,
        });
      } catch (err) {
        // The status change stands; the admin sees the failure in the logs
        // and can notify the Praxis by phone.
        console.error(
          `[animations] ready mail failed instance=${id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  revalidatePath("/admin/operations");
  revalidatePath("/admin");
}
