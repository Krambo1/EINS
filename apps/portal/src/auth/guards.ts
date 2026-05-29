import "server-only";
import { redirect } from "next/navigation";
import { getSession, type ResolvedSession } from "./session";
import { can, type Permission, ForbiddenError } from "../lib/roles";

/**
 * Guards — thin wrappers around getSession() with idiomatic redirect/throw
 * behaviour for server components AND API route handlers.
 *
 * Naming:
 *  - requireSession()        → redirect to /login if unauthenticated
 *  - requirePermissionOr403  → throws ForbiddenError (caller maps to 403 response)
 *
 * Server components use the redirect variants; JSON APIs use the throwing variants.
 */

/** Returns a logged-in session or redirects to /login. */
export async function requireSession(opts?: {
  /** Redirect target if not logged in. */
  to?: string;
}): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) {
    redirect(opts?.to ?? "/login");
  }
  return session;
}

/** Returns a session OR null, without redirect. Useful for marketing-y pages. */
export async function optionalSession(): Promise<ResolvedSession | null> {
  return await getSession();
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
  if (!can(session.role, permission)) {
    throw new ForbiddenError(permission);
  }
  return session;
}
