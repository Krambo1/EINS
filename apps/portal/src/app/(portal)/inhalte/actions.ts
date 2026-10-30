"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isImpersonating, requireSession } from "@/auth/guards";
import { decideApprovalInPortal } from "@/server/content-approval";
import { APPROVAL_DECISION_LABELS } from "@/lib/content-approval";
import { formatDateTime } from "@/lib/formatting";

/**
 * The action of the Inhalte page. It returns its result instead of
 * setting the flash cookie: the card shows it as a toast (showActionFlash),
 * so nothing appears or grows inside the card (DESIGN.md section 10).
 */
export type InhalteResult = {
  ok: boolean;
  title: string;
  description?: string;
  /** A decision was saved now (false: an earlier one stands). */
  recorded?: boolean;
};

const NO_CONNECTION = "Bitte laden Sie die Seite neu und versuchen Sie es erneut.";

// ---------------------------------------------------------------------------
// Freigabe
// ---------------------------------------------------------------------------

const DecisionSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["freigegeben", "aenderung"]),
  changeText: z.string().max(5000).optional(),
});

/**
 * Portal side of the approval (D7): the same decision as the e-mail link,
 * through decideApprovalInPortal (role check, first decision wins). An EINS
 * admin in "Als Benutzer öffnen" cannot decide: approval is the Praxis' own.
 */
export async function decidePostAction(input: {
  approvalId: string;
  decision: "freigegeben" | "aenderung";
  changeText?: string;
}): Promise<InhalteResult> {
  const session = await requireSession();
  if (isImpersonating(session)) {
    return { ok: false, title: "Nicht gespeichert", description: "In der Ansicht als Benutzer entscheidet nur die Praxis selbst." };
  }
  const parsed = DecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, title: "Nicht gespeichert", description: NO_CONNECTION };
  const d = parsed.data;
  const result = await decideApprovalInPortal(session, d.approvalId, d.decision, d.changeText ?? null);
  revalidatePath("/inhalte");
  if (!result.ok) return { ok: false, title: "Nicht gespeichert", description: result.message };
  if (!result.recorded) {
    return {
      ok: true,
      recorded: false,
      title: "Schon entschieden",
      description: `${APPROVAL_DECISION_LABELS[result.decision.decision]} am ${formatDateTime(result.decision.decidedAt)}. Es gilt die erste Entscheidung.`,
    };
  }
  if (result.decision.decision === "freigegeben") {
    return { ok: true, recorded: true, title: "Beitrag freigegeben", description: "EINS plant ihn jetzt ein." };
  }
  return {
    ok: true,
    recorded: true,
    title: "Änderungswunsch gesendet",
    description: "EINS überarbeitet den Beitrag und schickt ihn erneut zur Freigabe.",
  };
}
