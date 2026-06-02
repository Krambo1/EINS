import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import type { Role } from "@/lib/constants";
import { can } from "@/lib/roles";
import { countNewRequests } from "./requests";
import { countNewPatientFeedback } from "./patient-feedback";
import { hasRecentTimelineUpdate } from "./timeline";
import { hasNewMedia } from "./assets";
import { hasNewDocuments } from "./documents";
import { hasUserPassedLeitfadenQuiz } from "./leitfaden";

/**
 * Cache TTL. 30 s in prod (long enough to absorb a refresh storm, short
 * enough that a new lead shows on the next nav). In dev we drop to 5 s
 * because Round 2 testing observed seed-driven mismatches between the
 * badge count and the DB row count — the cache outlived the seed for
 * 30 s and made the discrepancy look like a real bug.
 */
const NAV_BADGES_TTL_SECONDS = process.env.NODE_ENV === "production" ? 30 : 5;

/**
 * Bundled, per-user cache for the six sidebar "Neu" badge queries the portal
 * layout runs on EVERY navigation. Previously each render fanned out 6 DB
 * round-trips (each opening its own transaction to SET LOCAL the RLS context).
 *
 * Why bundled:
 *   `unstable_cache` is per-function-key; if we wrapped each query
 *   individually we'd still serialize six cache lookups. One bundle, six
 *   queries inside on a miss, one cache hit on subsequent navs.
 *
 * TTL is intentionally short (30 s in prod, 5 s in dev — see
 * `NAV_BADGES_TTL_SECONDS`) so a brand-new lead landing in the portal
 * surfaces in the badge promptly even if no explicit invalidation fires.
 * For interactions that *should* clear the badge immediately (opening a
 * lead detail, visiting a section), the mutating call should invoke
 * `invalidateNavBadges(clinicId, userId)` after its write — see callers
 * in requests.ts / navBadges.ts.
 */

export interface NavBadgeBundle {
  newRequests: number;
  newFeedback: number;
  timelineHasUpdate: boolean;
  medienHasUpdate: boolean;
  dokumenteHasUpdate: boolean;
  hasPassedLeitfaden: boolean;
}

async function computeNavBadges(
  clinicId: string,
  userId: string,
  role: Role
): Promise<NavBadgeBundle> {
  const [
    newRequests,
    newFeedback,
    timelineHasUpdate,
    medienHasUpdate,
    dokumenteHasUpdate,
    hasPassedLeitfaden,
  ] = await Promise.all([
    can(role, "requests.view")
      ? countNewRequests(clinicId, userId)
      : Promise.resolve(0),
    can(role, "patient_feedback.view")
      ? countNewPatientFeedback(clinicId, userId)
      : Promise.resolve(0),
    hasRecentTimelineUpdate(clinicId, userId),
    can(role, "assets.view")
      ? hasNewMedia(clinicId, userId)
      : Promise.resolve(false),
    can(role, "documents.view.marketing")
      ? hasNewDocuments(clinicId, userId, role)
      : Promise.resolve(false),
    can(role, "leitfaden.quiz")
      ? hasUserPassedLeitfadenQuiz(clinicId, userId)
      : Promise.resolve(true),
  ]);
  return {
    newRequests,
    newFeedback,
    timelineHasUpdate,
    medienHasUpdate,
    dokumenteHasUpdate,
    hasPassedLeitfaden,
  };
}

export function getNavBadges(
  clinicId: string,
  userId: string,
  role: Role
): Promise<NavBadgeBundle> {
  if (!clinicId || !userId) {
    throw new Error("getNavBadges: clinicId and userId are required");
  }
  return unstable_cache(
    () => computeNavBadges(clinicId, userId, role),
    ["nav-badges", clinicId, userId, role],
    {
      tags: [navBadgesTag(clinicId, userId)],
      revalidate: NAV_BADGES_TTL_SECONDS,
    }
  )();
}

export function navBadgesTag(clinicId: string, userId: string): string {
  return `nav-badges:${clinicId}:${userId}`;
}

/**
 * Best-effort cache flush for this user's badge bundle. Called from
 * mutations that immediately change a badge value (markSectionSeen,
 * markRequestViewed, etc.) so the next render doesn't show a stale pill.
 */
export function invalidateNavBadges(clinicId: string, userId: string): void {
  if (!clinicId || !userId) return;
  try {
    revalidateTag(navBadgesTag(clinicId, userId));
  } catch {
    // NAV_BADGES_TTL_SECONDS is the safety net.
  }
}
