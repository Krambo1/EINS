"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession, markSessionMfaVerified } from "@/auth/session";
import { verifyLoginCode } from "@/auth/totp";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

const Schema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "Bitte geben Sie Ihren 6-stelligen Code ein.")
    .max(12),
});

export type MfaVerifyState =
  | { ok: false; error: string }
  | { ok: true }
  | undefined;

export async function verifyMfaAction(
  _prev: MfaVerifyState,
  formData: FormData
): Promise<MfaVerifyState> {
  const session = await getSession();
  if (!session) {
    redirect("/login?error=session_expired");
  }

  const parsed = Schema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültiger Code." };
  }

  const rl = await rateLimit("mfa:user", session.userId, {
    limit: 5,
    windowSeconds: 60 * 5,
  });
  if (!rl.ok) {
    return {
      ok: false,
      error: "Zu viele Versuche. Bitte warten Sie 5 Minuten.",
    };
  }

  const kind = await verifyLoginCode(session.userId, parsed.data.code);
  if (!kind) {
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "mfa_verify_failed",
      entityKind: "login",
    });
    return { ok: false, error: "Der Code ist nicht korrekt oder abgelaufen." };
  }

  await markSessionMfaVerified(session.sessionId);
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "mfa_verify",
    entityKind: "login",
    diff: { kind },
  });

  redirect("/dashboard");
}
