"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { sendFeedbackEmail } from "@/server/email";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  type FeedbackCategory,
} from "@/lib/constants";

const Input = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(5, "Bitte mindestens 5 Zeichen eingeben.").max(4000),
  pageUrl: z.string().trim().max(500).optional().or(z.literal("")),
});

export type SubmitFeedbackState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success" };

/**
 * Submit feedback to the EINS team. Persists a row in `feedback` and emails
 * Karam best-effort. Available to every clinic role.
 */
export async function submitFeedbackAction(
  _prev: SubmitFeedbackState | undefined,
  formData: FormData
): Promise<SubmitFeedbackState> {
  const session = await requireSession();
  if (!can(session.role, "feedback.submit")) {
    throw new ForbiddenError("feedback.submit");
  }

  const parsed = Input.safeParse({
    category: formData.get("category"),
    message: formData.get("message"),
    pageUrl: formData.get("pageUrl") ?? undefined,
  });
  if (!parsed.success) {
    return {
      kind: "error",
      message:
        parsed.error.issues[0]?.message ??
        "Bitte prüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
    };
  }

  const { category, message } = parsed.data;
  const pageUrl = parsed.data.pageUrl?.trim() ? parsed.data.pageUrl.trim() : null;

  let feedbackId: string | undefined;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [row] = await tx
      .insert(schema.feedback)
      .values({
        clinicId: session.clinicId,
        submittedBy: session.userId,
        category,
        message,
        pageUrl,
      })
      .returning({ id: schema.feedback.id });
    feedbackId = row?.id;
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "submit_feedback",
    entityKind: "feedback",
    entityId: feedbackId,
    diff: { category, length: message.length, pageUrl },
  });

  // Best-effort notification to Karam.
  try {
    const [clinic] = await db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1);
    await sendFeedbackEmail({
      to: "karam@einsvisuals.com",
      clinicName: clinic?.displayName ?? "Unbekannte Praxis",
      submittedBy: session.email,
      categoryLabel: FEEDBACK_CATEGORY_LABELS[category as FeedbackCategory],
      message,
      pageUrl: pageUrl ?? undefined,
    });
  } catch {
    // Swallow — the row is in the DB, we can pick it up there.
  }

  revalidatePath("/feedback");
  return { kind: "success" };
}
