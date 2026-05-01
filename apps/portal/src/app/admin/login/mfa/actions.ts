"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminSession, markAdminSessionMfaVerified } from "@/auth/admin";
import {
  verifyAndFinalizeAdminEnrollment,
  verifyAdminLoginCode,
} from "@/auth/admin-totp";
import { writeAudit } from "@/server/audit";

/**
 * Finalize enrollment. Admin has scanned the QR (secret is on-screen) and
 * typed the first 6-digit code. On success we mark the session MFA-verified
 * so they don't bounce back through /admin/login/mfa immediately.
 */
const FinalizeSchema = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().regex(/^\d{6}$/),
});

export async function finalizeAdminMfaEnrollAction(formData: FormData) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  const parsed = FinalizeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");

  try {
    await verifyAndFinalizeAdminEnrollment(
      session.adminId,
      parsed.data.secret,
      parsed.data.code
    );
  } catch {
    redirect("/admin/login/mfa?error=invalid_code");
  }

  await markAdminSessionMfaVerified(session.sessionId);
  await writeAudit({
    actorEmail: session.email,
    action: "update",
    entityKind: "admin_mfa",
    diff: { enrolled: true },
  });

  redirect("/admin");
}

/**
 * Step-up verification for an already-enrolled admin.
 */
const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function verifyAdminMfaAction(formData: FormData) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  const parsed = VerifySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/login/mfa?error=invalid_code");

  const ok = await verifyAdminLoginCode(session.adminId, parsed.data.code);
  if (!ok) {
    await writeAudit({
      actorEmail: session.email,
      action: "login",
      entityKind: "admin_mfa",
      diff: { verified: false },
    });
    redirect("/admin/login/mfa?error=invalid_code");
  }

  await markAdminSessionMfaVerified(session.sessionId);
  await writeAudit({
    actorEmail: session.email,
    action: "login",
    entityKind: "admin_mfa",
    diff: { verified: true },
  });
  redirect("/admin");
}
