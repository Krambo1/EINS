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
  FileText,
  CheckCircle2,
  Circle,
} from "lucide-react";

export const metadata = { title: "Onboarding" };

/**
 * Onboarding checklist. Each step is checked against an actual signal in the
 * DB so the clinic sees real progress. When everything is green we celebrate.
 *
 * Deliberately Inhaber-only: each step either requires inhaber rights or is
 * meaningful only for the clinic owner.
 */
export default async function OnboardingPage() {
  const session = await requirePermissionOrRedirect("onboarding.complete");

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  const [teamRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.clinicId, session.clinicId),
        isNull(schema.clinicUsers.archivedAt)
      )
    );
  const teamCount = teamRow?.count ?? 0;

  const credentials = await db
    .select({ platform: schema.platformCredentials.platform })
    .from(schema.platformCredentials)
    .where(eq(schema.platformCredentials.clinicId, session.clinicId));

  const assetRows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(eq(schema.assets.clinicId, session.clinicId))
    .limit(1);

  const goalRows = await db
    .select({ id: schema.goals.id })
    .from(schema.goals)
    .where(eq(schema.goals.clinicId, session.clinicId))
    .limit(1);

  const steps: Step[] = [
    {
      key: "profile",
      title: "Praxis-Angaben hinterlegen",
      description:
        "Name, HWG-Verantwortliche, Ansprechperson – damit in Verträgen und HWG-Prüfungen alles stimmt.",
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
        "Einmal OAuth-Zustimmung, danach synchronisieren wir Budget und Anfragen täglich.",
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
        "Was bedeutet für Sie ein guter Monat? Anfragen oder Umsatz – wir arbeiten in diese Richtung.",
      done: goalRows.length > 0,
      action: { label: "Zum Dashboard", href: "/dashboard" },
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
    {
      key: "media",
      title: "Erste Medien bereitstellen",
      description:
        "Wir produzieren in den ersten vier Wochen Ihr Kernpaket. Sobald die ersten Videos und Fotos fertig sind, erscheinen sie im Portal.",
      done: assetRows.length > 0,
      action: { label: "Medien ansehen", href: "/medien" },
      icon: <Camera className="h-5 w-5" />,
    },
    {
      key: "playbook",
      title: "Vertriebsleitfaden lesen",
      description:
        "Wie aus einer Anfrage eine Behandlung wird. Kurz, konkret, auf Ihre Rezeption zugeschnitten.",
      done: false, // We don't track reads — always visible as recommended.
      action: { label: "Zum Leitfaden", href: "/leitfaden" },
      icon: <Phone className="h-5 w-5" />,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">
          Willkommen bei EINS.
        </h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Mit diesen Schritten ist Ihr Portal einsatzbereit. Sie können alles
          auch später erledigen — die Reihenfolge ist nur ein Vorschlag.
        </p>
      </header>

      {/* Progress */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-sm text-fg-secondary">
                Ihr Einrichtungsstand
              </div>
              <div className="mt-1 font-display text-3xl font-semibold tabular-nums">
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
        </CardContent>
      </Card>

      {/* Steps */}
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Card>
              <CardContent className="flex flex-wrap items-start gap-4 p-5">
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
                  <p className="mt-1 text-base text-fg-primary">
                    {s.description}
                  </p>
                  {s.hint && (
                    <p className="mt-1 text-sm text-fg-secondary">{s.hint}</p>
                  )}
                </div>
                {!s.done && s.action && (
                  <Button asChild>
                    <Link href={s.action.href}>{s.action.label}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      {pct === 100 && (
        <Card>
          <CardHeader>
            <CardTitle>Herzlichen Glückwunsch – alles eingerichtet.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-base text-fg-primary">
            <p>
              Ihr Portal ist startklar. Ab jetzt sehen Sie im Dashboard
              laufend, wie Ihre Werbung läuft und welche Anfragen hereinkommen.
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
  title: string;
  description: string;
  done: boolean;
  hint?: string;
  action?: { label: string; href: string };
  icon?: React.ReactNode;
}
