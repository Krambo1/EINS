import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/auth/magic-link";
import { writeAudit } from "@/server/audit";

/**
 * Magic-link landing endpoint. Reached by the user clicking the email link.
 *
 *   GET /api/auth/callback?token=<url-safe-token>
 *
 * On success we create an unverified session (via consumeMagicLink) and
 * redirect the user into the MFA flow:
 *   - If MFA is already enrolled → /login/mfa (verify)
 *   - If MFA not yet enrolled → /login/enroll-mfa (first-time setup)
 *
 * On failure we redirect to /login with an error query.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=missing_token", req.nextUrl.origin)
    );
  }

  const result = await consumeMagicLink(token);
  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/login?error=${result.reason}`, req.nextUrl.origin)
    );
  }

  await writeAudit({
    clinicId: result.clinicId,
    actorId: result.userId,
    action: "login",
    entityKind: "login",
    diff: { method: "magic_link", intent: result.intent },
  });

  const next = result.mfaEnrolled ? "/login/mfa" : "/login/enroll-mfa";
  return NextResponse.redirect(new URL(next, req.nextUrl.origin));
}
