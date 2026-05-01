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
  "dashboard.view.full": ["inhaber", "marketing"],
  // Anfragen
  "requests.view": ["inhaber", "marketing", "frontdesk"],
  "requests.update": ["inhaber", "marketing", "frontdesk"],
  "requests.bulk_assign": ["inhaber", "marketing"],
  "requests.create_manual": ["inhaber", "marketing", "frontdesk"],
  // Medien
  "assets.view": ["inhaber", "marketing"],
  "assets.download": ["inhaber", "marketing"],
  "assets.upload": [] as Role[], // nur Karam (super-admin)
  // Animationen
  "animations.view": ["inhaber", "marketing"],
  "animations.request_customization": ["inhaber", "marketing"],
  // Auswertung
  "reports.view": ["inhaber", "marketing"],
  // Werbebudget Live
  "campaigns.live": ["inhaber", "marketing"],
  // Dokumente
  "documents.view.all": ["inhaber"],
  "documents.view.marketing": ["inhaber", "marketing"],
  "documents.view.all_roles": ["inhaber", "marketing", "frontdesk"],
  // Plan & Upgrade
  "plan.view": ["inhaber"],
  "plan.request_upgrade": ["inhaber"],
  // Einstellungen
  "settings.team": ["inhaber"],
  "settings.integrations": ["inhaber"],
  "audit.view": ["inhaber"],
  // Tools
  "tools.hwg_check": ["inhaber", "marketing"],
  "tools.what_if": ["inhaber", "marketing"],
  // Onboarding
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

export function requireRole<R extends Role>(
  actual: Role | undefined,
  allowed: readonly R[]
): asserts actual is R {
  if (!actual || !allowed.includes(actual as R)) {
    throw new ForbiddenError("dashboard.view");
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

/** Documents visible to a role (plan §6 "Verträge & Dokumente"). */
export function documentVisibleToRole(
  visibleToRoles: string[] | null | undefined,
  role: Role | undefined
): boolean {
  if (!role) return false;
  if (!visibleToRoles || visibleToRoles.length === 0) return role === "inhaber";
  return visibleToRoles.includes(role);
}
