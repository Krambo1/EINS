"use server";

import { requireSession } from "@/auth/guards";
import { markSectionSeen, type NavSection } from "@/server/queries/navBadges";

const SECTIONS: readonly NavSection[] = ["fortschritt", "medien", "dokumente"];

/**
 * Stamps a sidebar section as seen. Called by PortalShell when the user
 * reaches Fortschritt / Medien / Dokumente by a click in the portal: on such
 * a soft navigation the (portal) layout does not render again, so its own
 * stamp (on a full page load) never runs.
 */
export async function markSectionSeenAction(section: string): Promise<void> {
  if (!(SECTIONS as readonly string[]).includes(section)) return;
  const session = await requireSession();
  await markSectionSeen(session.clinicId, session.userId, section as NavSection);
}
