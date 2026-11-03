import { and, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDate } from "@/lib/formatting";
import { getOnboardingGateStatus } from "@/server/queries/onboardingGate";
import { CONTROL, DashCard, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { HeadCount, OnboardingHead } from "../_components/OnboardingHead";
import { StatusWord, type OnboardingStatus } from "../_components/StatusWord";
import { GATE_LINE, LIST_BODY, ONBOARDING_PAGE, ROW_LIST, STEP_ROW, TITLED_LIST_BODY } from "../_lib/sizes";

export const metadata = { title: "Erste Schritte" };

/**
 * Erste Schritte: the setup steps as one list, each checked against a real
 * signal in the DB (GOV.UK's task list, Shopify's setup guide). A row is
 * the step's name and one meta line with its status first; the whole row
 * leads to the page where the step is done. The next open step carries the
 * page's one button.
 *
 * Deliberately Inhaber-only: each step either requires inhaber rights or is
 * meaningful only for the clinic owner.
 */
export default async function OnboardingPage() {
  const session = await requirePermissionOrRedirect("onboarding.complete");

  // All reads are independent: one parallel wave. The gate status is the
  // same React-cached call the layout already made for this request (no
  // second Fragebogen/Checkliste read).
  const [[clinic], [teamRow], credentials, [discoveryRow], gate] = await Promise.all([
    db
      .select({
        retreatmentRemindersEnabled: schema.clinics.retreatmentRemindersEnabled,
        retreatmentConsentAttested: schema.clinics.retreatmentConsentAttested,
      })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, session.clinicId),
          isNull(schema.clinicUsers.archivedAt)
        )
      ),
    db
      .select({ platform: schema.platformCredentials.platform })
      .from(schema.platformCredentials)
      .where(eq(schema.platformCredentials.clinicId, session.clinicId)),
    db
      .select({
        status: schema.discoveryFragebogen.status,
        submittedAt: schema.discoveryFragebogen.submittedAt,
      })
      .from(schema.discoveryFragebogen)
      .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
      .limit(1),
    getOnboardingGateStatus(session.clinicId),
  ]);
  const teamCount = teamRow?.count ?? 0;
  const discoverySubmitted = discoveryRow?.status === "eingereicht";
  const platforms = new Set(credentials.map((c) => c.platform));

  // Access gate: same source as the layout redirect (getOnboardingGateStatus),
  // so this page and the redirect can never disagree. Until the Grundlagen
  // zum Start are in, the Checkliste row counts those; then the Pflichtpunkte.
  const blockersOpen = gate.blockersDelivered < gate.blockersTotal;

  const steps: Step[] = [
    {
      key: "fragebogen",
      title: "Fragebogen ausfüllen",
      href: "/onboarding/fragebogen",
      status: discoverySubmitted ? "erledigt" : "offen",
      meta: discoverySubmitted
        ? `Eingereicht am ${formatDate(discoveryRow?.submittedAt)}`
        : discoveryRow
          ? "Entwurf gespeichert"
          : "15 bis 20 Minuten",
    },
    {
      key: "checkliste",
      title: "Checkliste liefern",
      href: "/onboarding/checkliste",
      status: gate.checklistComplete ? "erledigt" : "offen",
      meta: blockersOpen
        ? `${gate.blockersDelivered} von ${gate.blockersTotal} Grundlagen zum Start`
        : `${gate.requiredDelivered} von ${gate.requiredTotal} Pflichtpunkten`,
    },
    // No "Praxis-Angaben" step: the Checkliste asks for the Ansprechperson
    // (A2) and the ärztliche Leitung (A3); EINS copies their e-mails into the
    // Stammdaten while checking Block A (Karam's cut, 2026-10-30).
    {
      key: "team",
      title: "Team einladen",
      href: "/einstellungen#team",
      status: teamCount >= 2 ? "erledigt" : "offen",
      meta: teamCount >= 2 ? `${teamCount} Personen im Team` : "Bisher nur Sie",
    },
    {
      key: "retreatment",
      title: "Erinnerungen einrichten",
      href: "/einstellungen#wiederbehandlungen",
      status: clinic?.retreatmentRemindersEnabled ? "erledigt" : "offen",
      meta: clinic?.retreatmentRemindersEnabled
        ? "Eingeschaltet"
        : clinic?.retreatmentConsentAttested
          ? "E-Mails noch ausgeschaltet"
          : "Für Folgebehandlungen",
    },
  ];

  // Organisch zuerst: the ad accounts only matter once bezahlte Anzeigen run,
  // so their step stands apart ("Erst für Anzeigen") and outside the count.
  const adsStep: Step = {
    key: "integrations",
    title: "Meta und Google Ads verbinden",
    href: "/einstellungen#werbekonten",
    status: platforms.size > 0 ? "erledigt" : "offen",
    meta:
      platforms.size === 0
        ? "Noch keins verbunden"
        : platforms.size > 1
          ? "Beide verbunden"
          : platforms.has("meta")
            ? "Meta verbunden"
            : "Google Ads verbunden",
  };

  const completed = steps.filter((s) => s.status !== "offen").length;
  // The next open step carries the page's one button.
  const currentKey = steps.find((s) => s.status === "offen")?.key;

  return (
    <div className={ONBOARDING_PAGE}>
      <OnboardingHead
        title="Erste Schritte"
        count={<HeadCount>{`${completed} von ${steps.length} erledigt`}</HeadCount>}
      />

      <DashCard bodyClassName={LIST_BODY}>
        {!gate.gateComplete && (
          <p className={GATE_LINE}>Alle Bereiche öffnen sich, sobald Fragebogen und Grundlagen erledigt sind.</p>
        )}
        <ol className={cn(ROW_LIST, !gate.gateComplete && "border-t border-border")}>
          {steps.map((s) => (
            <li key={s.key} className={WASH_ROW}>
              <StepRow step={s} current={s.key === currentKey} />
            </li>
          ))}
        </ol>
      </DashCard>

      <DashCard title="Erst für Anzeigen" className="[--delay:40ms]" bodyClassName={TITLED_LIST_BODY}>
        <ul className={ROW_LIST}>
          <li className={WASH_ROW}>
            <StepRow step={adsStep} current={false} />
          </li>
        </ul>
      </DashCard>
    </div>
  );
}

/**
 * One step: its name, then the status and one fact on the meta line. The
 * current step shows "Öffnen" where the others have their chevron; on the
 * phone the row alone is the button, so the meta line keeps its room.
 */
function StepRow({ step, current }: { step: Step; current: boolean }) {
  return (
    <Link href={step.href} aria-current={current ? "step" : undefined} className={STEP_ROW}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5 text-fg-primary">{step.title}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-sm leading-5 text-fg-secondary">
          <StatusWord status={step.status} />
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate tabular-nums">{step.meta}</span>
        </span>
      </span>
      {current && (
        <Button asChild className={cn(CONTROL, "hidden shrink-0 px-4 sm:inline-flex")}>
          <span aria-hidden>Öffnen</span>
        </Button>
      )}
      <ChevronRight
        aria-hidden
        className={cn("h-5 w-5 shrink-0 text-fg-tertiary", current && "sm:hidden")}
      />
    </Link>
  );
}

interface Step {
  key: string;
  title: string;
  href: string;
  status: OnboardingStatus;
  /** One fact after the status, under 30 characters so the row keeps one line. */
  meta: string;
}
