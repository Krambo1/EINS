"use server";

import { eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";

/**
 * Lifecycle writes for the interactive portal tour. Both update the logged-in
 * user's own clinic_users row on the superuser connection (mirrors
 * updateOwnProfileAction), scoped by session.userId. Audit-logged.
 *
 * No revalidatePath: the flags are read through getSession(), which is only
 * React.cache()'d per request, so the next request reads them fresh. The
 * provider also keeps its own client state for the rest of the session, so a
 * resolved prompt never re-appears without a write being needed.
 */

/** Set when the user reaches the end of the tour ("Fertig"). */
export async function completeOnboardingTourAction(): Promise<void> {
  const session = await requireSession();
  await db
    .update(schema.clinicUsers)
    .set({ onboardingTourCompletedAt: new Date() })
    .where(eq(schema.clinicUsers.id, session.userId));

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "complete",
    entityKind: "onboarding_tour",
    entityId: session.userId,
  });
}

/**
 * Resolve the one-time first-login prompt without completing the tour. Sets
 * onboarding_tour_dismissed_at so the prompt never auto-shows again.
 *
 * @param outcome "started" (user launched the tour from the prompt) or
 *                "skipped" (user clicked "Später"). Recorded in the audit
 *                action; both set the same dismissed flag.
 */
export async function dismissOnboardingTourAction(
  outcome: "started" | "skipped",
): Promise<void> {
  const session = await requireSession();
  await db
    .update(schema.clinicUsers)
    .set({ onboardingTourDismissedAt: new Date() })
    .where(eq(schema.clinicUsers.id, session.userId));

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: outcome === "started" ? "tour_started" : "dismiss",
    entityKind: "onboarding_tour",
    entityId: session.userId,
  });
}

/**
 * Permanently dismiss the left-nav tour card (the user clicked its X). The
 * tour stays re-launchable from Einstellungen; only this one surface is
 * suppressed for good. Same write path / no-revalidate rationale as above.
 */
export async function dismissTourNavCardAction(): Promise<void> {
  const session = await requireSession();
  await db
    .update(schema.clinicUsers)
    .set({ onboardingTourNavCardDismissedAt: new Date() })
    .where(eq(schema.clinicUsers.id, session.userId));

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "dismiss_nav_card",
    entityKind: "onboarding_tour",
    entityId: session.userId,
  });
}
