import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { anfragenNavBadge } from "@/lib/nav-badge-text";
import { ActionFlashToast } from "./_components/ActionFlashToast";
import { ChecklistReminderBanner } from "./_components/ChecklistReminderBanner";
import { TourProvider } from "./_components/tour/TourProvider";
import { OnboardingGateGuard } from "./_components/OnboardingGateGuard";
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
import { can } from "@/lib/roles";

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
  const h = await headers();
  const pathname = h.get("x-portal-pathname");

  // Onboarding access gate. A real Inhaber (not an impersonating admin) must
  // submit the Fragebogen and deliver the Blocker checklist items before the
  // data tabs unlock. Until then every non-allowed path bounces to the
  // onboarding hub. Team roles and impersonating admins skip the gate (they
  // can't complete onboarding / shouldn't be forced through it). Computed once
  // here so the rest of the layout can reuse it for the banner + tour timing.
  //
  // Everything the layout needs is read in ONE parallel wave: gate status,
  // clinic header, the six nav badges (one statement, see navBadgesCache.ts)
  // and the flash cookie. The redirect is decided after the wave.
  const gateApplies =
    can(session.role, "onboarding.complete") && session.impersonatedByAdminId === null;
  const [gate, clinic, badges, actionFlash, cookieStore] = await Promise.all([
    gateApplies ? getOnboardingGateStatus(session.clinicId) : Promise.resolve(null),
    getClinicHeader(session.clinicId),
    getNavBadges(session.clinicId, session.userId, session.role as Role),
    readActionFlash(),
    cookies(),
  ]);
  if (gate && !gate.gateComplete && !isGateAllowedPath(pathname)) {
    redirect("/onboarding");
  }

  // Stamp the section as seen AFTER the response (not as a blocking write
  // in the render path). The pill of the current section is overridden to 0
  // below; the next render reads the stamp (badges are not cached).
  const section = currentSection(pathname);
  if (section) {
    const { clinicId, userId } = session;
    after(() => markSectionSeen(clinicId, userId, section));
  }

  // Sidebar contact card minimized state — read here (server-side) so the
  // first paint matches the user's last choice instead of flashing expanded.
  const contactCardCollapsed =
    cookieStore.get(CONTACT_CARD_COOKIE)?.value === "1";
  const {
    newRequests,
    dueFollowups,
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
        impersonationExpiresAt={
          session.impersonatedByAdminId !== null
            ? new Date(session.expiresAt).toISOString()
            : null
        }
        contactCardCollapsed={contactCardCollapsed}
        pendingBadges={{ leitfaden: !hasPassedLeitfaden }}
        navBadgeCounts={{
          "/anfragen": anfragenNavBadge(newRequests, dueFollowups),
          "/bewertungen": newFeedback,
          "/bewertungen/feedback": newFeedback,
          // The section the user is on is stamped as seen after this
          // response (see `after` above), so the badges read in this render
          // still count it as new. Override its pill to 0 here.
          "/fortschritt": section !== "fortschritt" && timelineHasUpdate ? "Neu" : 0,
          "/medien": section !== "medien" && medienHasUpdate ? "Neu" : 0,
          "/dokumente": section !== "dokumente" && dokumenteHasUpdate ? "Neu" : 0,
        }}
      >
        <OnboardingGateGuard gateClosed={gate != null && !gate.gateComplete} />
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
