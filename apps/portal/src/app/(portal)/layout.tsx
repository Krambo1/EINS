import type { ReactNode } from "react";
import { headers } from "next/headers";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { ActionFlashToast } from "./_components/ActionFlashToast";
import { getClinicHeader } from "@/server/queries/clinic";
import { hasUserPassedLeitfadenQuiz } from "@/server/queries/leitfaden";
import { countNewRequests } from "@/server/queries/requests";
import { countNewPatientFeedback } from "@/server/queries/stimme";
import { hasRecentTimelineUpdate } from "@/server/queries/timeline";
import { hasNewMedia } from "@/server/queries/assets";
import { hasNewDocuments } from "@/server/queries/documents";
import {
  markSectionSeen,
  type NavSection,
} from "@/server/queries/navBadges";
import { can } from "@/lib/roles";
import type { Role } from "@/lib/constants";
import { readActionFlash } from "@/lib/flash";

/**
 * Map first-segment of the current pathname to a NavSection so the layout
 * can clear that section's "Neu" pill *before* it computes badge state.
 * Without this, the layout and page render in parallel — the page's own
 * markSeen lands after the layout has already counted the badge as unseen,
 * so the pill only clears on the user's NEXT navigation.
 */
const PATHNAME_TO_SECTION: Record<string, NavSection> = {
  fortschritt: "fortschritt",
  medien: "medien",
  dokumente: "dokumente",
};

function currentSection(pathname: string | null): NavSection | null {
  if (!pathname) return null;
  const first = pathname.split("/").filter(Boolean)[0];
  return first ? (PATHNAME_TO_SECTION[first] ?? null) : null;
}

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  // Clear the active section's "Neu" pill *before* the badge queries run —
  // otherwise the layout would compute the badge from pre-mark state and
  // the pill would only disappear on the next navigation.
  const h = await headers();
  const section = currentSection(h.get("x-portal-pathname"));
  if (section) {
    await markSectionSeen(session.clinicId, session.userId, section);
  }

  const [
    clinic,
    hasPassedLeitfaden,
    newRequests,
    newFeedback,
    timelineHasUpdate,
    medienHasUpdate,
    dokumenteHasUpdate,
    actionFlash,
  ] = await Promise.all([
    getClinicHeader(session.clinicId),
    can(session.role, "leitfaden.quiz")
      ? hasUserPassedLeitfadenQuiz(session.clinicId, session.userId)
      : Promise.resolve(true),
    can(session.role, "requests.view")
      ? countNewRequests(session.clinicId, session.userId)
      : Promise.resolve(0),
    can(session.role, "stimme.view")
      ? countNewPatientFeedback(session.clinicId, session.userId)
      : Promise.resolve(0),
    hasRecentTimelineUpdate(session.clinicId, session.userId),
    can(session.role, "assets.view")
      ? hasNewMedia(session.clinicId, session.userId)
      : Promise.resolve(false),
    can(session.role, "documents.view.marketing")
      ? hasNewDocuments(
          session.clinicId,
          session.userId,
          session.role as Role
        )
      : Promise.resolve(false),
    readActionFlash(),
  ]);

  return (
    <>
      <PortalShell
        user={{
          email: session.email,
          fullName: session.fullName,
          avatarUrl: session.avatarUrl,
          role: session.role,
        }}
        clinic={clinic ?? { id: session.clinicId, displayName: "", logoUrl: null }}
        impersonating={session.impersonatedByAdminId !== null}
        pendingBadges={{ leitfaden: !hasPassedLeitfaden }}
        navBadgeCounts={{
          "/anfragen": newRequests,
          "/bewertungen": newFeedback,
          "/bewertungen/feedback": newFeedback,
          "/fortschritt": timelineHasUpdate ? "Neu" : 0,
          "/medien": medienHasUpdate ? "Neu" : 0,
          "/dokumente": dokumenteHasUpdate ? "Neu" : 0,
        }}
      >
        {children}
      </PortalShell>
      <ActionFlashToast flash={actionFlash} />
    </>
  );
}
