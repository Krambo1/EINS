import "server-only";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getAdminSession, type ResolvedAdmin } from "./admin";

/**
 * Guard for admin pages. Redirects to /admin/login if not signed in, or to
 * MFA step-up when enrolled but not verified.
 */
export async function requireAdmin(opts: { skipMfa?: boolean } = {}): Promise<ResolvedAdmin> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!opts.skipMfa) {
    // /admin/login/mfa renders the enrollment QR for unenrolled admins and
    // the step-up code field for enrolled ones — single redirect covers
    // both paths. The page itself uses requireAdmin({ skipMfa: true }).
    if (!session.mfaEnrolled || !session.mfaVerified) {
      redirect("/admin/login/mfa");
    }
  }
  return session;
}

/**
 * Guard for `/api/admin/*` JSON routes. Same checks as `requireAdmin` but
 * never redirects — instead returns a NextResponse the caller can short-
 * circuit with. Page-style `redirect()` on a JSON endpoint produces a
 * 307→/admin/login HTML body to a fetch() client, which has to be parsed as
 * JSON and explodes; 403 with a structured error is the right answer.
 *
 * Usage:
 *   const gate = await requireAdminForApi();
 *   if (!gate.ok) return gate.response;
 *   const admin = gate.admin;
 */
export type RequireAdminApiResult =
  | { ok: true; admin: ResolvedAdmin }
  | { ok: false; response: NextResponse };

export async function requireAdminForApi(
  opts: { skipMfa?: boolean } = {}
): Promise<RequireAdminApiResult> {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "not_authenticated" } },
        { status: 401 }
      ),
    };
  }
  if (!opts.skipMfa && (!session.mfaEnrolled || !session.mfaVerified)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "mfa_required" } },
        { status: 403 }
      ),
    };
  }
  return { ok: true, admin: session };
}
