"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { PATIENT_FEEDBACK_STATUSES } from "@/lib/constants";

const IdSchema = z.string().uuid();

export async function setFeedbackStatusAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "patient_feedback.manage"))
    throw new ForbiddenError("patient_feedback.manage");

  const input = z
    .object({
      id: IdSchema,
      status: z.enum(PATIENT_FEEDBACK_STATUSES),
    })
    .parse({
      id: formData.get("id"),
      status: formData.get("status"),
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.patientFeedback)
      .set({
        status: input.status,
        resolvedAt:
          input.status === "geschlossen" || input.status === "beantwortet"
            ? new Date()
            : null,
        resolvedBy:
          input.status === "geschlossen" || input.status === "beantwortet"
            ? session.userId
            : null,
      })
      .where(
        and(
          eq(schema.patientFeedback.id, input.id),
          eq(schema.patientFeedback.clinicId, session.clinicId)
        )
      );
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "patient_feedback",
    entityId: input.id,
    diff: { status: input.status },
  });

  revalidatePath("/bewertungen/feedback");
  revalidatePath(`/bewertungen/feedback/${input.id}`);
  revalidatePath("/dashboard");
}

export async function setFeedbackNoteAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "patient_feedback.manage"))
    throw new ForbiddenError("patient_feedback.manage");

  const input = z
    .object({
      id: IdSchema,
      internalNote: z.string().max(5000).optional(),
    })
    .parse({
      id: formData.get("id"),
      internalNote: formData.get("internalNote") ?? undefined,
    });

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.patientFeedback)
      .set({ internalNote: input.internalNote || null })
      .where(
        and(
          eq(schema.patientFeedback.id, input.id),
          eq(schema.patientFeedback.clinicId, session.clinicId)
        )
      );
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "patient_feedback",
    entityId: input.id,
    diff: { hasNote: Boolean(input.internalNote) },
  });

  revalidatePath(`/bewertungen/feedback/${input.id}`);
}
