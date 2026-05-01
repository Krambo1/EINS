"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { withClinicContext, db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { getEmailSender } from "@/server/email";

const Input = z.object({
  libraryId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

/**
 * Clinic user asks for a customized version of an animation.
 * Creates (or updates) the animation_instance row to state=requested,
 * notifies Karam by email.
 */
export async function requestAnimationCustomizationAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "animations.request_customization")) {
    throw new ForbiddenError("animations.request_customization");
  }
  const input = Input.parse({
    libraryId: formData.get("libraryId"),
    note: formData.get("note") ?? undefined,
  });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    // Upsert — unique (clinic_id, library_id).
    const existing = await tx
      .select()
      .from(schema.animationInstances)
      .where(
        and(
          eq(schema.animationInstances.clinicId, session.clinicId),
          eq(schema.animationInstances.libraryId, input.libraryId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(schema.animationInstances)
        .set({
          status: "requested",
          requestedBy: session.userId,
          requestedAt: new Date(),
          requestNote: input.note ?? null,
        })
        .where(eq(schema.animationInstances.id, existing[0]!.id));
    } else {
      await tx.insert(schema.animationInstances).values({
        clinicId: session.clinicId,
        libraryId: input.libraryId,
        status: "requested",
        requestedBy: session.userId,
        requestedAt: new Date(),
        requestNote: input.note ?? null,
      });
    }
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "request_animation",
    entityKind: "animation_instance",
    entityId: input.libraryId,
    diff: { note: input.note },
  });

  // Best-effort notification. We don't want a mail failure to block the UI.
  try {
    const [clinic] = await db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1);
    const [library] = await db
      .select({ title: schema.animationLibrary.title })
      .from(schema.animationLibrary)
      .where(eq(schema.animationLibrary.id, input.libraryId))
      .limit(1);
    const subject = `Animations-Anpassung angefragt: ${clinic?.displayName ?? session.clinicId}`;
    const text = [
      subject,
      "",
      `Praxis:     ${clinic?.displayName ?? session.clinicId}`,
      `Nutzer:     ${session.email}`,
      `Animation:  ${library?.title ?? input.libraryId}`,
      `Notiz:      ${input.note ?? "(keine)"}`,
    ].join("\n");
    await getEmailSender().send({
      to: "karam@einsvisuals.com",
      subject,
      text,
      html: `<pre style="font-family:inherit; white-space:pre-wrap">${text}</pre>`,
    });
  } catch {
    // Swallow — the request is persisted.
  }

  revalidatePath("/animationen");
}
