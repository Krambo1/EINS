import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";

/**
 * Stable section keys used in `user_nav_section_views.section`. Add to this
 * union when wiring a new sidebar "Neu" pill — the table doesn't constrain
 * the value, but the union keeps callers honest.
 */
export type NavSection = "fortschritt" | "medien" | "dokumente";

/**
 * Upper bound on how far back a never-visited user's badge will look. Stops
 * a brand-new account from seeing "Neu" for ancient archived content.
 */
const NEW_USER_LOOKBACK_DAYS = 14;

/**
 * The threshold against which a section's content `created_at` (or similar)
 * should be compared to decide whether to surface the "Neu" pill. Returns
 * the user's own last-seen timestamp for this section, or — for never-
 * visited users — a 14-day-ago fallback so the badge only surfaces actually
 * recent content for new accounts.
 */
export async function sectionBadgeThreshold(
  clinicId: string,
  userId: string,
  section: NavSection
): Promise<Date> {
  const fallback = new Date(
    Date.now() - NEW_USER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );
  const row = await withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [r] = await tx
        .select({ lastSeenAt: schema.userNavSectionViews.lastSeenAt })
        .from(schema.userNavSectionViews)
        .where(
          and(
            eq(schema.userNavSectionViews.userId, userId),
            eq(schema.userNavSectionViews.section, section)
          )
        )
        .limit(1);
      return r ?? null;
    },
    `nav:threshold:${section}`
  );
  return row?.lastSeenAt ?? fallback;
}

/**
 * Stamps this user's last-seen timestamp for the given section to now,
 * clearing the corresponding sidebar "Neu" pill. Idempotent via UPSERT.
 * Best-effort — failures are swallowed so a transient write never breaks
 * the page render that triggered it.
 */
export async function markSectionSeen(
  clinicId: string,
  userId: string,
  section: NavSection
): Promise<void> {
  try {
    await withClinicContext(
      clinicId,
      userId,
      (tx) =>
        tx
          .insert(schema.userNavSectionViews)
          .values({ userId, section, lastSeenAt: new Date() })
          .onConflictDoUpdate({
            target: [
              schema.userNavSectionViews.userId,
              schema.userNavSectionViews.section,
            ],
            set: { lastSeenAt: sql`now()` },
          }),
      `nav:mark-seen:${section}`
    );
  } catch {
    // Non-critical — silently drop.
  }
}
