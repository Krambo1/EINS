import { and, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import {
  Phone,
  Link as LinkIcon,
  Users,
  Camera,
  ClipboardList,
  ClipboardCheck,
  FileText,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { getOnboardingGateStatus } from "@/server/queries/onboardingGate";

export const metadata = { title: "Erste Schritte" };

/**
 * Onboarding checklist. Each step is checked against an actual signal in the
 * DB so the clinic sees real progress. When everything is green we celebrate.
 *
 * Deliberately Inhaber-only: each step either requires inhaber rights or is
 * meaningful only for the clinic owner.
 */
export default async function OnboardingPage() {
  const session = await requirePermissionOrRedirect("onboarding.complete");

  // All reads are independent: one parallel wave instead of seven sequential
  // round trips. The gate status is the same React-cached call the layout
  // already made for this request (no second Fragebogen/Checkliste read).
  const [
    [clinic],
    [teamRow],
    credentials,
    assetRows,
    goalRows,
    [discoveryRow],
    gate,
  ] = await Promise.all([
    db
      .select({
        hwgContactEmail: schema.clinics.hwgContactEmail,
        defaultDoctorEmail: schema.clinics.defaultDoctorEmail,
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
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(eq(schema.assets.clinicId, session.clinicId))
      .limit(1),
    db
      .select({ id: schema.goals.id })
      .from(schema.goals)
      .where(eq(schema.goals.clinicId, session.clinicId))
      .limit(1),
    db
      .select({ status: schema.discoveryFragebogen.status })
      .from(schema.discoveryFragebogen)
      .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
      .limit(1),
    getOnboardingGateStatus(session.clinicId),
  ]);
  const teamCount = teamRow?.count ?? 0;
  const discoverySubmitted = discoveryRow?.status === "eingereicht";

  const checklistTotal = gate.requiredTotal;
  const checklistDelivered = gate.requiredDelivered;
  const checklistDone = gate.checklistComplete;

  // Access gate: same source as the layout redirect (getOnboardingGateStatus),
  // so this page and the redirect can never disagree.
  const blockersTotal = gate.blockersTotal;
  const blockersDelivered = gate.blockersDelivered;
  const gateComplete = gate.gateComplete;

  const steps: Step[] = [
    {
      key: "fragebogen",
      title: "Fragebogen zum Start ausfüllen",
      description:
        "Etwa 15 bis 20 Minuten zu Behandlungen, Zielen und Ihrer heutigen Patientengewinnung. Darauf bauen Ihre Beiträge, Zielseite und Anzeigen auf.",
      done: discoverySubmitted,
      hint: discoveryRow && !discoverySubmitted
        ? "Entwurf gespeichert. Sie können jederzeit weitermachen."
        : undefined,
      action: { label: "Fragebogen öffnen", href: "/onboarding/fragebogen" },
      icon: <ClipboardList className="h-5 w-5" />,
    },
    {
      key: "checkliste",
      title: "Checkliste zum Start liefern",
      description:
        "Zugänge, Logo, Bildmaterial, Klon-Aufnahme, Einwilligung und ein paar Angaben, alles direkt im Portal. Daraus bauen wir Ihren KI-Klon, Ihre Zielseite und Ihre ersten Beiträge.",
      done: checklistDone,
      hint: checklistDone
        ? "Alle Pflichtpunkte geliefert."
        : checklistDelivered > 0
          ? `${checklistDelivered} von ${checklistTotal} Pflichtpunkten geliefert.`
          : undefined,
      action: { label: "Checkliste öffnen", href: "/onboarding/checkliste" },
      icon: <ClipboardCheck className="h-5 w-5" />,
    },
    {
      key: "profile",
      title: "Praxis-Angaben hinterlegen",
      description:
        "Name, HWG-Verantwortliche, Ansprechperson, damit in Verträgen und HWG-Prüfungen alles stimmt.",
      done: Boolean(clinic?.hwgContactEmail && clinic.defaultDoctorEmail),
      action: { label: "Zu den Einstellungen", href: "/einstellungen" },
      icon: <FileText className="h-5 w-5" />,
    },
    {
      key: "team",
      title: "Team einladen",
      description:
        "Rezeption und Marketing sollten mitschauen können. Jede Person bekommt eine eigene Einladung per E-Mail.",
      done: teamCount >= 2,
      hint:
        teamCount >= 2
          ? `${teamCount} Personen im Team.`
          : "Bisher nur Sie. Laden Sie mindestens eine weitere Person ein.",
      action: { label: "Team verwalten", href: "/einstellungen" },
      icon: <Users className="h-5 w-5" />,
    },
    {
      key: "integrations",
      title: "Meta und Google Ads verbinden",
      description:
        "Einmal zustimmen, danach holen wir Werbezahlen und Anfragen täglich ab. Werbebudget brauchen Sie zu Beginn nicht: Wir starten organisch.",
      done: credentials.length >= 1,
      hint: credentials.length === 1
        ? "Eine Plattform verbunden. Zweite fehlt noch."
        : credentials.length === 0
        ? undefined
        : "Beide Plattformen verbunden.",
      action: {
        label: "Jetzt verbinden",
        href: "/einstellungen#integrationen",
      },
      icon: <LinkIcon className="h-5 w-5" />,
    },
    {
      key: "goals",
      title: "Monatsziel festlegen",
      description:
        "Was bedeutet für Sie ein guter Monat? Anfragen oder Umsatz, wir arbeiten in diese Richtung.",
      done: goalRows.length > 0,
      action: { label: "Zur Übersicht", href: "/dashboard" },
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
    {
      key: "media",
      title: "Erste Beiträge ansehen",
      description:
        "Ihre ersten Beiträge entstehen in Woche 1 bis 2. Sobald sie fertig sind, erscheinen sie im Portal. Veröffentlicht wird erst nach Ihrer Freigabe.",
      done: assetRows.length > 0,
      action: { label: "Medien ansehen", href: "/medien" },
      icon: <Camera className="h-5 w-5" />,
    },
    {
      key: "playbook",
      title: "Vertriebsleitfaden lesen",
      description:
        "Wie aus einer Anfrage eine Behandlung wird. Kurz, konkret, auf Ihre Rezeption zugeschnitten.",
      done: false, // We don't track reads: always visible as recommended.
      action: { label: "Zum Leitfaden", href: "/leitfaden" },
      icon: <Phone className="h-5 w-5" />,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);
  // Only the first open step with an action gets the primary button.
  const primaryKey = steps.find((s) => !s.done && s.action)?.key;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">
          Willkommen bei EINS.
        </h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Mit diesen Schritten ist Ihr Portal einsatzbereit. Die Reihenfolge ist
          nur ein Vorschlag.
        </p>
      </header>

      {/* One block: setup progress plus, until Fragebogen + Grundlagen zum Start are in
          and the data tabs unlock, what is still missing. */}
      <Card className="p-5 md:p-6">
        <CardContent className="divide-y divide-border">
          <div className="pb-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="text-sm text-fg-secondary">
                  Ihr Einrichtungsstand
                </div>
                <div className="mt-1 font-display text-2xl font-semibold tabular-nums md:text-3xl">
                  {completed} / {total} Schritte
                </div>
              </div>
              <Badge tone={pct === 100 ? "good" : "accent"}>{pct} %</Badge>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-bg-secondary">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {gateComplete ? (
            <div className="flex items-start gap-3 pt-5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-tone-good" />
              <div>
                <p className="font-semibold text-fg-primary">
                  Ihr Portal ist freigeschaltet.
                </p>
                <p className="mt-1 text-sm text-fg-secondary">
                  Sie können jetzt alle Bereiche nutzen. Die übrigen Schritte
                  unten helfen, das Beste aus EINS herauszuholen.
                </p>
              </div>
            </div>
          ) : (
            <div className="pt-5">
              <p className="font-semibold text-fg-primary">
                Bis zur Freischaltung fehlt noch
              </p>
              <p className="mt-1 text-sm text-fg-secondary">
                Sobald Ihr Fragebogen und die wichtigsten Grundlagen zum Start vorliegen,
                schalten wir Übersicht, Anfragen und alle weiteren Bereiche frei.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-fg-primary">
                {[
                  { done: discoverySubmitted, text: "Fragebogen einreichen" },
                  {
                    done: blockersDelivered >= blockersTotal,
                    text: `${blockersDelivered} von ${blockersTotal} Grundlagen zum Start in der Checkliste liefern`,
                  },
                ].map((item) => (
                  <li key={item.text} className="flex items-center gap-2">
                    {item.done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-tone-good" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
                    )}
                    <span className="sr-only">{item.done ? "Erledigt: " : "Offen: "}</span>
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Steps */}
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Card className="p-5 md:p-6">
              <CardContent
                className={`flex flex-wrap gap-4 ${s.done ? "items-center" : "items-start"}`}
              >
                <div
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border ${
                    s.done
                      ? "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] text-tone-good"
                      : "border-border bg-bg-secondary text-fg-primary"
                  }`}
                >
                  {s.done ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : (
                    s.icon ?? <Circle className="h-6 w-6" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-fg-secondary">
                      Schritt {i + 1}
                    </span>
                    <span className="font-semibold text-fg-primary md:text-lg">
                      {s.title}
                    </span>
                    {s.done && <Badge tone="good">Erledigt</Badge>}
                  </div>
                  {!s.done && (
                    <p className="mt-1 text-base text-fg-primary">
                      {s.description}
                    </p>
                  )}
                  {s.hint && (
                    <p className="mt-1 text-sm text-fg-secondary">{s.hint}</p>
                  )}
                </div>
                {!s.done && s.action && (
                  <Button
                    asChild
                    variant={s.key === primaryKey ? "default" : "outline"}
                    className="w-full md:w-auto"
                  >
                    <Link href={s.action.href}>{s.action.label}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      {pct === 100 && (
        <Card className="p-5 md:p-6">
          <CardHeader>
            <CardTitle>Herzlichen Glückwunsch, alles eingerichtet.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-base text-fg-primary">
            <p>
              Ihr Portal ist startklar. Ab jetzt sehen Sie in der Übersicht
              laufend, wie Ihre Beiträge und Anzeigen laufen und welche Anfragen
              hereinkommen.
            </p>
            <p>
              Wir bleiben im Hintergrund dran. Melden Sie sich jederzeit, wenn
              Sie etwas anpassen möchten.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface Step {
  key: string;
  title: React.ReactNode;
  description: React.ReactNode;
  done: boolean;
  hint?: string;
  action?: { label: string; href: string };
  icon?: React.ReactNode;
}
