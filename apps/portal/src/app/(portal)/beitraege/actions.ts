"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, isImpersonating } from "@/auth/guards";
import { flashError, flashSuccess } from "@/lib/flash";
import { decideApprovalInPortal } from "@/server/content-approval";
import { APPROVAL_DECISION_LABELS } from "@/lib/content-approval";
import { formatDateTime } from "@/lib/formatting";

/**
 * Portal side of the approval (D7): the same decision as the e-mail link,
 * through decideApprovalInPortal (role check, first decision wins). An EINS
 * admin in "Als Benutzer öffnen" cannot decide: approval is the Praxis' own.
 */

const DecisionSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["freigegeben", "aenderung"]),
  changeText: z.string().max(5000).optional(),
});

export async function decideBeitragAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (isImpersonating(session)) {
    await flashError("In der Ansicht als Benutzer entscheidet nur die Praxis selbst.");
    return;
  }
  const parsed = DecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await flashError("Eingabe ungültig. Bitte die Seite neu laden.");
    return;
  }
  const d = parsed.data;
  const result = await decideApprovalInPortal(session, d.approvalId, d.decision, d.changeText ?? null);
  if (!result.ok) {
    await flashError(result.message);
  } else if (!result.recorded) {
    await flashSuccess(
      "Schon entschieden",
      `${APPROVAL_DECISION_LABELS[result.decision.decision]} am ${formatDateTime(result.decision.decidedAt)}. Es gilt die erste Entscheidung.`
    );
  } else if (result.decision.decision === "freigegeben") {
    await flashSuccess("Beitrag freigegeben");
  } else {
    await flashSuccess("Änderungswunsch gesendet", "EINS überarbeitet den Beitrag und schickt ihn erneut zur Freigabe.");
  }
  revalidatePath("/beitraege");
}
