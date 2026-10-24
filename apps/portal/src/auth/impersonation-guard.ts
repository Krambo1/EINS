/**
 * What an EINS admin may NOT do inside an "Als Benutzer öffnen" session.
 *
 * Owner decision (2026-10-07): writes stay allowed, because Karam helps
 * Praxen on the phone, and every write is attributed to the admin in the audit
 * log (server/audit.ts). Three account-takeover-shaped actions stay blocked:
 * setting/changing the password, changing the login email, and "auf allen
 * Geräten abmelden" (B-8 / B-26 / G-10).
 *
 * Pure module (no server imports) so it is unit-testable.
 */

export type ImpersonationBlockedAction =
  | "password"
  | "login_email"
  | "logout_all_devices";

const MESSAGES: Record<ImpersonationBlockedAction, string> = {
  password:
    "In der Ansicht als Benutzer kann kein Passwort gesetzt oder geändert werden.",
  login_email:
    "In der Ansicht als Benutzer kann die Anmelde-E-Mail nicht geändert werden.",
  logout_all_devices:
    "In der Ansicht als Benutzer ist „Überall abmelden“ gesperrt.",
};

export class ImpersonationBlockedError extends Error {
  readonly action: ImpersonationBlockedAction;
  constructor(action: ImpersonationBlockedAction) {
    super(MESSAGES[action]);
    this.name = "ImpersonationBlockedError";
    this.action = action;
  }
}

export function impersonationBlockedMessage(
  action: ImpersonationBlockedAction
): string {
  return MESSAGES[action];
}

/** True when the session was opened by an admin via "Als Benutzer öffnen". */
export function isImpersonating(session: {
  impersonatedByAdminId: string | null;
}): boolean {
  return session.impersonatedByAdminId !== null;
}

/** Throws ImpersonationBlockedError for the blocked actions. */
export function assertNotImpersonating(
  session: { impersonatedByAdminId: string | null },
  action: ImpersonationBlockedAction
): void {
  if (isImpersonating(session)) throw new ImpersonationBlockedError(action);
}
