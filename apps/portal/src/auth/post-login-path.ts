import "server-only";
import type { Role } from "@/lib/constants";
import { can, defaultLandingPath } from "@/lib/roles";
import {
  getOnboardingGateStatus,
  isGateAllowedPath,
} from "@/server/queries/onboardingGate";

/**
 * Where a clinic user lands right after the password login (a Server Action).
 *
 * The (portal) layout bounces an Inhaber with an open onboarding gate from
 * every locked path to /onboarding. When that bounce follows the action's own
 * redirect (login -> /dashboard -> /onboarding), the Next.js client router
 * replays the history update endlessly and the owner sees a white page. So the
 * action resolves the gate itself and redirects once, straight to the final
 * page. Same rule as the layout: `onboarding.complete` permission, gate status
 * from getOnboardingGateStatus, allowed paths from isGateAllowedPath. Login is
 * never an impersonation, so that layout condition is always met here.
 *
 * `next` must already be validated (safeNextPath). The result is either that
 * path, the role's landing page, or "/onboarding".
 */
export async function postLoginPath(
  user: { clinicId: string; role: Role | null },
  next: string | null
): Promise<string> {
  const target = next ?? defaultLandingPath(user.role);
  if (!can(user.role, "onboarding.complete") || isGateAllowedPath(target)) {
    return target;
  }
  const gate = await getOnboardingGateStatus(user.clinicId);
  return gate.gateComplete ? target : "/onboarding";
}
