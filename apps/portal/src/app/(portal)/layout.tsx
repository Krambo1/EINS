import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { ActionFlashToast } from "./_components/ActionFlashToast";
import { ChecklistReminderBanner } from "./_components/ChecklistReminderBanner";
import { TourProvider } from "./_components/tour/TourProvider";
import { getClinicHeader } from "@/server/queries/clinic";
import {
  getOnboardingGateStatus,
  isGateAllowedPath,
} from "@/server/queries/onboardingGate";
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
  const pathname = h.get("x-portal-pathname");

  // Onboarding access gate. A real Inhaber (not an impersonating admin) must
  // submit the Fragebogen and deliver the Blocker checklist items before the
  // data tabs unlock. Until then every non-allowed path bounces to the
  // onboarding hub. Team roles and impersonating admins skip the gate (they
  // can't complete onboarding / shouldn't be forced through it). Computed once
  // here so the rest of the layout can reuse it for the banner + tour timing.
  const gate =
    session.role === "inhaber" && session.impersonatedByAdminId === null
      ? await getOnboardingGateStatus(session.clinicId)
      : null;
  if (gate && !gate.gateComplete && !isGateAllowedPath(pathname)) {
    redirect("/onboarding");
  }

  const section = currentSection(pathname);
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

  // First-login tour prompt: Inhaber only, both tour flags still null, not
  // impersonating — AND only once onboarding is complete, so the prompt never
  // pops while the owner is still being walked through the gated onboarding.
  const tourEligible =
    session.role === "inhaber" &&
    session.impersonatedByAdminId === null;
  const autoPromptTour =
    tourEligible &&
    !session.onboardingTourCompletedAt &&
    !session.onboardingTourDismissedAt &&
    gate?.gateComplete === true;

  // Left-nav tour card. Eligible = Inhaber, not impersonating, hasn't X'd it.
  // It shows once the first-login prompt was skipped or the tour abandoned
  // (dismissed flag set, never completed). TourProvider also flips it live on
  // those events; this is the cross-session/initial-paint state.
  const navCardEligible =
    tourEligible && !session.onboardingTourNavCardDismissedAt;
  const navCardInitiallyVisible =
    navCardEligible &&
    !!session.onboardingTourDismissedAt &&
    !session.onboardingTourCompletedAt;

  // Soft nudge on the data tabs while the gate is open but the full mandatory
  // checklist still has open items. Never on the onboarding hub itself.
  const showChecklistBanner =
    gate?.gateComplete === true &&
    !gate.checklistComplete &&
    !(pathname ?? "").startsWith("/onboarding");

  return (
    <TourProvider
      autoPrompt={autoPromptTour}
      navCardEligible={navCardEligible}
      navCardInitiallyVisible={navCardInitiallyVisible}
    >
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
        {showChecklistBanner && gate && (
          <ChecklistReminderBanner
            remaining={gate.requiredTotal - gate.requiredDelivered}
          />
        )}
        {children}
      </PortalShell>
      <ActionFlashToast flash={actionFlash} />
    </TourProvider>
  );
}
