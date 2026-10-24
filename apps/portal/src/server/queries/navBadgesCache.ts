import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { Role } from "@/lib/constants";
import { can } from "@/lib/roles";
import { CURRENT_QUESTIONS_VERSION } from "@/app/(portal)/leitfaden/pruefung/questions";
import { NEW_USER_LOOKBACK_DAYS } from "./navBadges";

/**
 * The sidebar badges the portal layout needs, in ONE statement inside ONE
 * transaction (one RLS context, one round trip), deduplicated per request
 * with React `cache()`.
 *
 * Previously: six `withClinicContext` transactions plus three
 * `sectionBadgeThreshold` transactions, in two waves, behind a 30 s
 * `unstable_cache` that could not be invalidated from the render that
 * stamped a section as seen (Next forbids `revalidateTag` during render), so
 * a cleared "Neu" pill came back on the next page. Now every render reads
 * the current state; the values are identical to the old per-query helpers
 * (`countNewRequests`, `countNewPatientFeedback`, `hasRecentTimelineUpdate`,
 * `hasNewMedia`, `hasNewDocuments`, `hasUserPassedLeitfadenQuiz`,
 * `sectionBadgeThreshold`), whose SQL is mirrored below.
 */

export interface NavBadgeBundle {
  newRequests: number;
  /** Pending Wiedervorlagen with due_at <= now() (same set as `dueFollowups`). */
  dueFollowups: number;
  newFeedback: number;
  timelineHasUpdate: boolean;
  medienHasUpdate: boolean;
  dokumenteHasUpdate: boolean;
  hasPassedLeitfaden: boolean;
  /**
   * The Praxis has a Meta/Google ad account connected or any campaign data.
   * Drives whether "Werbebudget" shows in the sidebar (organic start: the
   * page stays reachable by URL and search, it just isn't listed yet).
   * Always false for roles without `campaigns.live`.
   */
  hasAdData: boolean;
}

/** Last-seen threshold for a section: the user's stamp or now() - 14 days. */
function threshold(userId: string, section: string) {
  return sql`coalesce(
    (SELECT v.last_seen_at FROM ${schema.userNavSectionViews} v
      WHERE v.user_id = ${userId} AND v.section = ${section} LIMIT 1),
    now() - make_interval(days => ${NEW_USER_LOOKBACK_DAYS}::int)
  )`;
}

async function computeNavBadges(
  clinicId: string,
  userId: string,
  role: Role
): Promise<NavBadgeBundle> {
  const no = sql`false`;
  const zero = sql`0`;
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx.execute(sql`
        SELECT
          ${
            can(role, "requests.view")
              ? sql`(SELECT count(*)::int FROM ${schema.requests} r
                     WHERE r.clinic_id = ${clinicId} AND r.status = 'neu'
                       AND r.first_viewed_at IS NULL)`
              : zero
          } AS new_requests,
          ${
            can(role, "requests.update")
              ? sql`(SELECT count(*)::int FROM ${schema.requestFollowups} f
                     WHERE f.clinic_id = ${clinicId} AND f.status = 'pending'
                       AND f.due_at <= now())`
              : zero
          } AS due_followups,
          ${
            can(role, "patient_feedback.view")
              ? sql`(SELECT count(*)::int FROM ${schema.patientFeedback} pf
                     WHERE pf.clinic_id = ${clinicId} AND pf.source = 'private'
                       AND pf.status = 'neu')`
              : zero
          } AS new_feedback,
          EXISTS (SELECT 1 FROM ${schema.clinicTimelineEntries} t
                  WHERE t.clinic_id = ${clinicId}
                    AND t.updated_at > ${threshold(userId, "fortschritt")}) AS timeline_update,
          ${
            can(role, "assets.view")
              ? sql`(EXISTS (SELECT 1 FROM ${schema.assets} a
                      WHERE a.clinic_id = ${clinicId}
                        AND a.created_at > ${threshold(userId, "medien")})
                     OR EXISTS (SELECT 1 FROM ${schema.animationInstances} ai
                      WHERE ai.clinic_id = ${clinicId}
                        AND ai.delivered_at IS NOT NULL
                        AND ai.delivered_at > ${threshold(userId, "medien")}))`
              : no
          } AS medien_update,
          ${
            can(role, "documents.view.marketing")
              ? sql`EXISTS (SELECT 1 FROM ${schema.documents} d
                     WHERE d.clinic_id = ${clinicId}
                       AND d.created_at > ${threshold(userId, "dokumente")}
                       AND ${role}::text = ANY(d.visible_to_roles))`
              : no
          } AS dokumente_update,
          ${
            can(role, "leitfaden.quiz")
              ? sql`EXISTS (SELECT 1 FROM ${schema.leitfadenQuizAttempts} q
                     WHERE q.user_id = ${userId} AND q.passed = true
                       AND q.questions_version >= ${CURRENT_QUESTIONS_VERSION}::int)`
              : sql`true`
          } AS passed_leitfaden,
          ${
            can(role, "campaigns.live")
              ? sql`(EXISTS (SELECT 1 FROM ${schema.platformCredentials} pc
                      WHERE pc.clinic_id = ${clinicId}
                        AND pc.platform IN ('meta','google'))
                     OR EXISTS (SELECT 1 FROM ${schema.campaignSnapshots} cs
                      WHERE cs.clinic_id = ${clinicId}))`
              : no
          } AS has_ad_data
      `),
    "nav:badges"
  );
  const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  return {
    newRequests: Number(r.new_requests ?? 0),
    dueFollowups: Number(r.due_followups ?? 0),
    newFeedback: Number(r.new_feedback ?? 0),
    timelineHasUpdate: r.timeline_update === true,
    medienHasUpdate: r.medien_update === true,
    dokumenteHasUpdate: r.dokumente_update === true,
    hasPassedLeitfaden: r.passed_leitfaden === true,
    hasAdData: r.has_ad_data === true,
  };
}

/** One round trip per request (React cache), always current. */
export const getNavBadges = cache(
  (clinicId: string, userId: string, role: Role): Promise<NavBadgeBundle> => {
    if (!clinicId || !userId) {
      throw new Error("getNavBadges: clinicId and userId are required");
    }
    return computeNavBadges(clinicId, userId, role);
  }
);

/**
 * Best-effort cache flush for this user's badge bundle. Called from
 * mutations that immediately change a badge value (markSectionSeen,
 * markRequestViewed, etc.) so the next render doesn't show a stale pill.
 */
export function invalidateNavBadges(clinicId: string, userId: string): void {
  // No-op since the badges are no longer cached across requests (every
  // render reads them fresh in one statement). Kept so existing callers in
  // requests.ts / anfragen actions keep compiling.
  void clinicId;
  void userId;
}
