"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession, markSessionMfaVerified } from "@/auth/session";
import { verifyAndFinalizeEnrollment, TotpError } from "@/auth/totp";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

const Schema = z.object({
  secret: z.string().min(16, "Ungültiger Schlüssel."),
  code: z.string().trim().min(6, "Bitte geben Sie Ihren 6-stelligen Code ein."),
});

export type EnrollState =
  | { ok: false; error: string }
  | { ok: true; backupCodes: string[] }
  | undefined;

/**
 * Verifies the first TOTP code + persists the encrypted secret.
 * On success we hand back the one-time backup codes so the UI can show them.
 */
export async function finalizeEnrollmentAction(
  _prev: EnrollState,
  formData: FormData
): Promise<EnrollState> {
  const session = await getSession();
  if (!session) {
    redirect("/login?error=session_expired");
  }
  if (session.mfaEnrolled) {
    // Already enrolled — bounce to the verify page.
    redirect("/login/mfa");
  }

  const parsed = Schema.safeParse({
    secret: formData.get("secret"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const rl = await rateLimit("mfa_enroll:user", session.userId, {
    limit: 10,
    windowSeconds: 60 * 10,
  });
  if (!rl.ok) {
    return { ok: false, error: "Zu viele Versuche. Bitte warten Sie 10 Minuten." };
  }

  try {
    const { backupCodes } = await verifyAndFinalizeEnrollment(
      session.userId,
      parsed.data.secret,
      parsed.data.code
    );
    await markSessionMfaVerified(session.sessionId);
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "mfa_enroll",
      entityKind: "login",
    });
    return { ok: true, backupCodes };
  } catch (err) {
    if (err instanceof TotpError) {
      return { ok: false, error: "Der Code ist nicht korrekt. Bitte versuchen Sie es erneut." };
    }
    throw err;
  }
}
