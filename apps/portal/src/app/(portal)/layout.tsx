import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { ActionFlashToast } from "./_components/ActionFlashToast";
import { getClinicHeader } from "@/server/queries/clinic";
import {
  markSectionSeen,
  type NavSection,
} from "@/server/queries/navBadges";
import { getNavBadges } from "@/server/queries/navBadgesCache";
import { CONTACT_CARD_COOKIE, type Role } from "@/lib/constants";
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

  // Clear the active section's "Neu" pill *before* the badge bundle runs —
  // otherwise the layout would compute the badge from pre-mark state and
  // the pill would only disappear on the next navigation. markSectionSeen
  // calls invalidateNavBadges internally so the bundle refetch below sees
  // the updated last-seen timestamp.
  const h = await headers();
  const section = currentSection(h.get("x-portal-pathname"));
  if (section) {
    await markSectionSeen(session.clinicId, session.userId, section);
  }

  // Sidebar contact card minimized state — read here (server-side) so the
  // first paint matches the user's last choice instead of flashing expanded.
  const contactCardCollapsed =
    (await cookies()).get(CONTACT_CARD_COOKIE)?.value === "1";

  const [clinic, badges, actionFlash] = await Promise.all([
    getClinicHeader(session.clinicId),
    getNavBadges(session.clinicId, session.userId, session.role as Role),
    readActionFlash(),
  ]);
  const {
    newRequests,
    newFeedback,
    timelineHasUpdate,
    medienHasUpdate,
    dokumenteHasUpdate,
    hasPassedLeitfaden,
  } = badges;

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
        contactCardCollapsed={contactCardCollapsed}
        pendingBadges={{ leitfaden: !hasPassedLeitfaden }}
        navBadgeCounts={{
          "/anfragen": newRequests,
          "/bewertungen": newFeedback,
          "/bewertungen/feedback": newFeedback,
          // `markSectionSeen` above calls `revalidateTag`, but Next.js only
          // applies tag invalidations to *subsequent* requests — the
          // `getNavBadges` call in this same render still returns the
          // pre-mark cached bundle. So if we just marked a section seen,
          // override its pill to 0 regardless of what the bundle reports.
          // Without this, the pill only disappears on the next navigation.
          "/fortschritt": section !== "fortschritt" && timelineHasUpdate ? "Neu" : 0,
          "/medien": section !== "medien" && medienHasUpdate ? "Neu" : 0,
          "/dokumente": section !== "dokumente" && dokumenteHasUpdate ? "Neu" : 0,
        }}
      >
        {children}
      </PortalShell>
      <ActionFlashToast flash={actionFlash} />
    </>
  );
}
