/**
 * Pure session-validity rules, kept free of DB / Next imports so they can be
 * unit-tested. `getSession()` (session.ts) loads one joined row per request
 * and asks this module whether the session may be used.
 *
 * Rules (each one locks a user out on the very next request, no extra query):
 *   - revoked or expired session row
 *   - archived clinic user (team member removed)               (B-11)
 *   - archived clinic ("Praxis archivieren" in admin)          (B-12 / G-05)
 *   - impersonation session whose admin is gone: the admin no longer passes
 *     the ADMIN_EMAILS allowlist, or has no live admin session anymore
 *     (admin logged out / sessions revoked)                    (B-25)
 */

export interface SessionRowForValidation {
  revokedAt: Date | null;
  expiresAt: Date;
  userArchivedAt: Date | null;
  clinicArchivedAt: Date | null;
  impersonatedByAdminId: string | null;
  /** admin_users.email of the impersonating admin (null when not impersonated). */
  impersonatorEmail: string | null;
  /** Whether that admin still has a non-revoked, non-expired admin session. */
  impersonatorHasActiveSession: boolean | null;
}

export type SessionRejectReason =
  | "revoked"
  | "expired"
  | "user_archived"
  | "clinic_archived"
  | "impersonator_not_allowed"
  | "impersonator_logged_out";

export function sessionRejectReason(
  row: SessionRowForValidation,
  now: Date,
  isAdminEmail: (email: string) => boolean
): SessionRejectReason | null {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.userArchivedAt) return "user_archived";
  if (row.clinicArchivedAt) return "clinic_archived";
  if (row.impersonatedByAdminId) {
    if (!row.impersonatorEmail || !isAdminEmail(row.impersonatorEmail)) {
      return "impersonator_not_allowed";
    }
    if (row.impersonatorHasActiveSession !== true) {
      return "impersonator_logged_out";
    }
  }
  return null;
}

/**
 * Whether `sessions.last_seen_at` is stale enough to be rewritten. Throttles
 * the per-request UPDATE to one write per `throttleSeconds` (D-5 / A-21).
 */
export function shouldTouchLastSeen(
  lastSeenAt: Date | null,
  now: Date,
  throttleSeconds: number
): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() >= throttleSeconds * 1000;
}

/**
 * Lifetime of a new session cookie/row. Impersonation always wins over
 * "Angemeldet bleiben" and is capped hard (B-25).
 */
export function sessionMaxAgeSeconds(
  opts: { impersonatedByAdminId?: string | null; rememberMe?: boolean },
  limits: { normal: number; remember: number; impersonation: number }
): number {
  if (opts.impersonatedByAdminId) return limits.impersonation;
  return opts.rememberMe ? limits.remember : limits.normal;
}
