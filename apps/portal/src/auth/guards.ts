import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, hasSessionCookie, type ResolvedSession } from "./session";
import { can, type Permission, ForbiddenError } from "../lib/roles";
import { loginRedirectPath } from "./safe-next";

export {
  assertNotImpersonating,
  isImpersonating,
  ImpersonationBlockedError,
  type ImpersonationBlockedAction,
} from "./impersonation-guard";

/** Pathname forwarded by middleware (see src/middleware.ts PATHNAME_HEADER). */
const PATHNAME_HEADER = "x-portal-pathname";

/**
 * /login URL for an unauthenticated request: carries `next=<current path>` so
 * the user lands back where they were, and `error=session_expired` when a
 * session cookie was present but is no longer valid (B-6).
 */
async function loginPathForCurrentRequest(): Promise<string> {
  let next: string | null = null;
  try {
    next = (await headers()).get(PATHNAME_HEADER);
  } catch {
    next = null;
  }
  let expired = false;
  try {
    expired = await hasSessionCookie();
  } catch {
    expired = false;
  }
  return loginRedirectPath({ next, expired });
}

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
    redirect(opts?.to ?? (await loginPathForCurrentRequest()));
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
  if (!can(session.role, permission)) {
    throw new ForbiddenError(permission);
  }
  return session;
}
