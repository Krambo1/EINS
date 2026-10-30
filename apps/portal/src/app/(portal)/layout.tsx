import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { ActionFlashToast } from "./_components/ActionFlashToast";
import { ChecklistReminderBanner } from "./_components/ChecklistReminderBanner";
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
import type { Role } from "@/lib/constants";
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
  // The Medien live on the Inhalte page (/medien redirects there).
  inhalte: "medien",
  // The documents live on the Dateien page (/dokumente redirects there).
  dateien: "dokumente",
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
  // here so the rest of the layout can reuse it for the banner.
  //
  // Everything the layout needs is read in ONE parallel wave: gate status,
  // clinic header, the six nav badges (one statement, see navBadgesCache.ts)
  // and the flash cookie. The redirect is decided after the wave.
  const gateApplies =
    can(session.role, "onboarding.complete") && session.impersonatedByAdminId === null;
  const [gate, clinic, badges, actionFlash] = await Promise.all([
    gateApplies ? getOnboardingGateStatus(session.clinicId) : Promise.resolve(null),
    getClinicHeader(session.clinicId),
    getNavBadges(session.clinicId, session.userId, session.role as Role),
    readActionFlash(),
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

  const {
    newFeedback,
    timelineHasUpdate,
    medienHasUpdate,
    dokumenteHasUpdate,
  } = badges;

  // Soft nudge on the data tabs while the gate is open but the full mandatory
  // checklist still has open items. Never on the onboarding hub itself.
  const showChecklistBanner =
    gate?.gateComplete === true &&
    !gate.checklistComplete &&
    !(pathname ?? "").startsWith("/onboarding");

  return (
    <>
      <PortalShell
        user={{
          email: session.email,
          fullName: session.fullName,
          role: session.role,
        }}
        clinic={clinic ?? { id: session.clinicId, displayName: "", logoUrl: null }}
        impersonating={session.impersonatedByAdminId !== null}
        impersonationExpiresAt={
          session.impersonatedByAdminId !== null
            ? new Date(session.expiresAt).toISOString()
            : null
        }
        navBadgeCounts={{
          "/bewertungen": newFeedback,
          "/bewertungen/feedback": newFeedback,
          // The section the user is on is stamped as seen after this
          // response (see `after` above), so the badges read in this render
          // still count it as new. Override its pill to 0 here.
          "/fortschritt": section !== "fortschritt" && timelineHasUpdate ? "Neu" : 0,
          "/inhalte": section !== "medien" && medienHasUpdate ? "Neu" : 0,
          "/dateien": section !== "dokumente" && dokumenteHasUpdate ? "Neu" : 0,
        }}
        notice={
          showChecklistBanner && gate ? (
            <ChecklistReminderBanner
              remaining={gate.requiredTotal - gate.requiredDelivered}
            />
          ) : null
        }
      >
        <OnboardingGateGuard gateClosed={gate != null && !gate.gateComplete} />
        {children}
      </PortalShell>
      <ActionFlashToast flash={actionFlash} />
    </>
  );
}
