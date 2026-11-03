"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { flashMessageFromError } from "@/lib/flash";
import type { ReplyTemplate } from "./_lib/reply-templates";
import {
  ReplyTemplateOpSchema,
  applyReplyTemplateOp,
  mergeReplyTemplates,
  parseStoredReplyTemplates,
  type ReplyTemplateOp,
} from "./_lib/reply-templates-store";

export type ReplyTemplatesResult =
  | { ok: true; templates: ReplyTemplate[] }
  | { ok: false; error: string };

/**
 * One change to the Praxis's Antwortvorlagen (save, reset to the shipped
 * words, delete an own one). Hands back the merged list, so the card shows
 * what is stored without a page render.
 */
export async function updateReplyTemplatesAction(
  input: ReplyTemplateOp
): Promise<ReplyTemplatesResult> {
  const session = await requireSession();
  try {
    if (!can(session.role, "reviews.manage")) throw new ForbiddenError("reviews.manage");
    const op = ReplyTemplateOpSchema.parse(input);

    const stored = await withClinicContext(session.clinicId, session.userId, async (tx) => {
      // FOR UPDATE: two people saving at once each keep their change.
      const [row] = await tx
        .select({ replyTemplates: schema.clinics.replyTemplates })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, session.clinicId))
        .for("update");
      const next = applyReplyTemplateOp(parseStoredReplyTemplates(row?.replyTemplates), op);
      const empty = Object.keys(next.edited).length === 0 && next.custom.length === 0;
      await tx
        .update(schema.clinics)
        .set({ replyTemplates: empty ? null : next })
        .where(eq(schema.clinics.id, session.clinicId));
      return next;
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "clinic_reply_templates",
      diff: { op: op.op, id: op.id },
    });

    revalidatePath("/bewertungen", "layout");
    return { ok: true, templates: mergeReplyTemplates(stored) };
  } catch (err) {
    return { ok: false, error: flashMessageFromError(err, "bewertungen.reply_templates") };
  }
}
