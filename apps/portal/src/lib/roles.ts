import type { Role } from "./constants";

/**
 * RBAC matrix — source of truth for D10 from plan §6.
 * Every screen and every action checks against this map.
 *
 * If a permission is missing here, the UI hides it AND the API rejects it.
 */
export const PERMISSIONS = {
  // Dashboard / KPIs
  "dashboard.view": ["inhaber", "marketing", "frontdesk"],
  "dashboard.view.full": ["inhaber", "marketing", "frontdesk"],
  // Anfragen
  "requests.view": ["inhaber", "marketing", "frontdesk"],
  "requests.update": ["inhaber", "marketing", "frontdesk"],
  "requests.bulk_assign": ["inhaber", "marketing", "frontdesk"],
  "requests.create_manual": ["inhaber", "marketing", "frontdesk"],
  // Medien
  "assets.view": ["inhaber", "marketing", "frontdesk"],
  "assets.download": ["inhaber", "marketing", "frontdesk"],
  "assets.upload": [] as Role[], // nur Karam (super-admin)
  // Animationen
  "animations.view": ["inhaber", "marketing", "frontdesk"],
  "animations.request_customization": ["inhaber", "marketing", "frontdesk"],
  // Auswertung
  "reports.view": ["inhaber", "marketing", "frontdesk"],
  // Werbebudget Live
  "campaigns.live": ["inhaber", "marketing", "frontdesk"],
  // Dokumente
  "documents.view.all": ["inhaber"], // Verträge, AVV — owner only
  "documents.view.marketing": ["inhaber", "marketing", "frontdesk"],
  "documents.view.all_roles": ["inhaber", "marketing", "frontdesk"],
  // Leitfaden — viewable + quiz testable by every clinic role (Mitwirkungspflicht)
  "leitfaden.view": ["inhaber", "marketing", "frontdesk"],
  "leitfaden.quiz": ["inhaber", "marketing", "frontdesk"],
  // Einstellungen — owner only (team, OAuth tokens, audit log)
  "settings.team": ["inhaber"],
  "settings.integrations": ["inhaber"],
  "audit.view": ["inhaber"],
  // Tools
  "tools.hwg_check": ["inhaber", "marketing", "frontdesk"],
  // Bewertungen / Reputation
  "reviews.view": ["inhaber", "marketing", "frontdesk"],
  "reviews.manage": ["inhaber", "marketing", "frontdesk"],
  // EINS Bewertungen — private patient feedback inbox
  "patient_feedback.view": ["inhaber", "marketing", "frontdesk"],
  "patient_feedback.manage": ["inhaber", "marketing"],
  // Feedback — anyone in the clinic can send feedback to EINS
  "feedback.submit": ["inhaber", "marketing", "frontdesk"],
  "feedback.view": ["inhaber", "marketing", "frontdesk"],
  // Onboarding — owner only (initial setup)
  "onboarding.complete": ["inhaber"],
} as const satisfies Record<string, readonly Role[] | Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return allowed.includes(role);
}

/** Assert a permission — throws a typed error for API/route consumers. */
export class ForbiddenError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(`Zugriff verweigert: ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

export function requirePermission(
  role: Role | undefined,
  permission: Permission
): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(permission);
  }
}

/**
 * Default post-auth landing path per role.
 *
 * Inhaber and Marketing-Verantwortliche treffen strategische Entscheidungen →
 * /dashboard. MFA & Sekretariat (`frontdesk`) closen Leads am Telefon → sie
 * landen direkt in der Anfragen-Inbox mit der Call-Queue oben.
 *
 * Single source of truth — alle Redirects (root, login, magic-link-callback,
 * set-password, impersonation) gehen hier durch, damit Frontdesk-User nicht
 * versehentlich auf einer halb-gerenderten Dashboard-Seite landen.
 */
export function defaultLandingPath(role: Role | undefined | null): string {
  return role === "frontdesk" ? "/anfragen" : "/dashboard";
}

/** Documents visible to a role (plan §6 "Verträge & Dokumente"). */
export function documentVisibleToRole(
  visibleToRoles: string[] | null | undefined,
  role: Role | undefined
): boolean {
  if (!role) return false;
  if (!visibleToRoles || visibleToRoles.length === 0) return role === "inhaber";
  return visibleToRoles.includes(role);
}
