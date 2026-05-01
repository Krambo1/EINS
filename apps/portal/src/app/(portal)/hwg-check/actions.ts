"use server";

import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { withClinicContext, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { checkHwg, type HwgResult } from "@/server/hwg";

const Input = z.object({
  text: z.string().min(1).max(5000),
});

export type CheckHwgState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "result"; input: string; result: HwgResult };

/**
 * Run the HWG screener on user-provided text. Persists a row in hwg_checks
 * so a clinic can reference past scans.
 */
export async function checkHwgAction(
  _prev: CheckHwgState | undefined,
  formData: FormData
): Promise<CheckHwgState> {
  const session = await requireSession();
  if (!can(session.role, "tools.hwg_check")) {
    throw new ForbiddenError("tools.hwg_check");
  }

  const parsed = Input.safeParse({ text: formData.get("text") });
  if (!parsed.success) {
    return {
      kind: "error",
      message: "Bitte geben Sie einen Text mit 1 bis 5000 Zeichen ein.",
    };
  }
  const { text } = parsed.data;
  const result = checkHwg(text);

  try {
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx.insert(schema.hwgChecks).values({
        clinicId: session.clinicId,
        actorId: session.userId,
        input: text,
        verdict: result.verdict,
        findings: result.findings,
      });
    });
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "hwg_check",
      entityKind: "hwg_check",
      diff: { verdict: result.verdict, hits: result.findings.length },
    });
  } catch {
    // Storage failure shouldn't hide the verdict from the user.
  }

  return { kind: "result", input: text, result };
}
