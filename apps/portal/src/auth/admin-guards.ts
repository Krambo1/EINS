import "server-only";
import { redirect } from "next/navigation";
import { getAdminSession, type ResolvedAdmin } from "./admin";

/**
 * Guard for admin pages. Redirects to /admin/login if not signed in, or to
 * MFA step-up when enrolled but not verified.
 */
export async function requireAdmin(opts: { skipMfa?: boolean } = {}): Promise<ResolvedAdmin> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!opts.skipMfa && session.mfaEnrolled && !session.mfaVerified) {
    redirect("/admin/login/mfa");
  }
  return session;
}
