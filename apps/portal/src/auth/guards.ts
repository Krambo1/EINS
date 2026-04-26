import "server-only";
import { redirect } from "next/navigation";
import { getSession, type ResolvedSession } from "./session";
import { can, type Permission, ForbiddenError } from "../lib/roles";
import type { Role } from "../lib/constants";

/**
 * Guards — thin wrappers around getSession() with idiomatic redirect/throw
 * behaviour for server components AND API route handlers.
 *
 * Naming:
 *  - requireSession()      → redirect to /login if unauthenticated
 *  - requireMfa()          → also require mfaVerified when mfaEnrolled
 *  - requirePermissionOr403() → throws ForbiddenError (caller maps to 403 response)
 *
 * Server components use the redirect variants; JSON APIs use the throwing variants.
 */

/** Returns a logged-in session or redirects to /login. */
export async function requireSession(opts?: {
  /** Redirect target if not logged in. */
  to?: string;
  /** Skip the MFA gate — e.g. the /login/mfa page itself. */
  skipMfa?: boolean;
}): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) {
    redirect(opts?.to ?? "/login");
  }
  // Impersonation sessions are admin-minted with mfaVerified=true; the admin's
  // own MFA already gated token issuance, so we don't run the user's MFA flow.
  const enforceMfa = !opts?.skipMfa && session.impersonatedByAdminId === null;
  if (enforceMfa && session.mfaEnrolled && !session.mfaVerified) {
    redirect("/login/mfa");
  }
  // If the user has never enrolled MFA they're force-routed through enrollment
  // before anything else. Exception: the enrollment page itself sets skipMfa=true.
  if (enforceMfa && !session.mfaEnrolled) {
    redirect("/login/enroll-mfa");
  }
  return session;
}

/** Returns a session OR null, without redirect. Useful for marketing-y pages. */
export async function optionalSession(): Promise<ResolvedSession | null> {
  return await getSession();
}

/** Redirect-version of role check. */
export async function requireRoleOrRedirect(
  allowed: readonly Role[]
): Promise<ResolvedSession> {
  const session = await requireSession();
  if (!allowed.includes(session.role)) {
    redirect("/?denied=1");
  }
  return session;
}

/** Redirect-version of permission check. */
export async function requirePermissionOrRedirect(
  permission: Permission
): Promise<ResolvedSession> {
  const session = await requireSession();
  if (!can(session.role, permission)) {
    redirect("/?denied=1");
  }
  return session;
}

/** Throw-version, intended for API route handlers. */
export async function requirePermissionOr403(
  permission: Permission
): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) {
    throw new ForbiddenError(permission);
  }
  if (session.mfaEnrolled && !session.mfaVerified) {
    throw new ForbiddenError(permission);
  }
  if (!can(session.role, permission)) {
    throw new ForbiddenError(permission);
  }
  return session;
}
