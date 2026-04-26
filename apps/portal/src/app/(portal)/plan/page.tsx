import { desc, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Separator,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { PLAN_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import { Check, Sparkles } from "lucide-react";
import { requestUpgradeAction } from "./actions";

export const metadata = { title: "Plan & Paket" };

const STANDARD_FEATURES = [
  "Videos und Fotos pro Quartal",
  "Bezahlte Anzeigen bei Meta und Google",
  "Anfrage-Posteingang mit KI-Filter",
  "Werbeauswertung live im Portal",
  "HWG-Vorab-Prüfung",
];

const ERWEITERT_FEATURES = [
  "Alles aus Standard",
  "3-Stunden-SLA für Anfragen (statt 24 h)",
  "Zusätzliche Animationen auf Wunsch",
  "Monatliches Strategie-Gespräch",
  "Vorrang-Support und persönlicher Kontakt",
  "Landingpage mit A/B-Varianten",
];

export default async function PlanPage() {
  const session = await requirePermissionOrRedirect("plan.view");

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);
  if (!clinic) return null;

  const [openUpgrade] = await db
    .select()
    .from(schema.upgradeRequests)
    .where(eq(schema.upgradeRequests.clinicId, session.clinicId))
    .orderBy(desc(schema.upgradeRequests.requestedAt))
    .limit(1);

  const isErweitert = clinic.plan === "erweitert";
  const hasOpenRequest = openUpgrade && openUpgrade.status === "offen";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Ihr Paket.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Wir haben zwei Pakete. Sie können jederzeit wechseln.
        </p>
      </header>

      {/* Current plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>Ihr aktuelles Paket</CardTitle>
            <Badge tone="accent">
              {PLAN_LABELS[clinic.plan as "standard" | "erweitert"] ?? clinic.plan}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="text-base text-fg-primary">
          <p>
            Sie sind seit {formatDateTime(clinic.planStartedAt)} im{" "}
            {PLAN_LABELS[clinic.plan as "standard" | "erweitert"]}-Paket.
          </p>
          {hasOpenRequest && (
            <p className="mt-3 rounded-md border border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] p-3 text-sm text-fg-primary">
              <strong>Upgrade-Anfrage offen:</strong> Wir melden uns bei Ihnen
              persönlich, um die Umstellung zu besprechen. Angefragt am{" "}
              {formatDateTime(openUpgrade.requestedAt)}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Plan comparison */}
      <section className="grid gap-6 md:grid-cols-2">
        <PlanCard
          title="Standard"
          isActive={clinic.plan === "standard"}
          features={STANDARD_FEATURES}
          description="Ihr solider Start. Werbung läuft, Anfragen kommen, Sie sehen Ergebnisse."
        />
        <PlanCard
          title="Erweitert"
          isActive={isErweitert}
          features={ERWEITERT_FEATURES}
          description="Für Praxen, die wachsen wollen. Schnellere Reaktion, mehr Medien, enge Begleitung."
          highlight
        />
      </section>

      {/* Upgrade request */}
      {!isErweitert && !hasOpenRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Auf Erweitert wechseln</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={requestUpgradeAction} className="space-y-4">
              <p className="text-base text-fg-primary">
                Teilen Sie uns mit, was Sie sich erhoffen. Wir melden uns binnen
                eines Werktags für ein persönliches Gespräch.
              </p>
              <textarea
                name="note"
                rows={4}
                placeholder="Optional: Was ist Ihnen besonders wichtig?"
                className="w-full rounded-xl border border-border bg-bg-primary p-3 text-base"
              />
              <Button type="submit">
                <Sparkles className="h-4 w-4" />
                Upgrade anfragen
              </Button>
              <p className="text-xs text-fg-secondary">
                Keine automatische Abrechnung. Jede Umstellung wird mit Ihnen
                persönlich abgesprochen.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      {session.uiMode === "detail" && (
        <>
          <Separator />

          {/* Plan comparison matrix */}
          <Card>
            <CardHeader>
              <CardTitle>Plan-Vergleich im Detail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-fg-secondary">
                      <th className="px-3 py-2">Funktion</th>
                      <th className="px-3 py-2 text-center">Standard</th>
                      <th className="px-3 py-2 text-center">Erweitert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {PLAN_MATRIX.map((row) => (
                      <tr key={row.feature}>
                        <td className="px-3 py-2 text-fg-primary">{row.feature}</td>
                        <td className="px-3 py-2 text-center">
                          {row.standard ? (
                            <Check className="mx-auto h-4 w-4 text-accent" />
                          ) : (
                            <span className="text-fg-tertiary">—</span>
                          )}
                          {typeof row.standard === "string" && (
                            <span className="text-xs text-fg-secondary">
                              {row.standard}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {row.erweitert ? (
                            <Check className="mx-auto h-4 w-4 text-accent" />
                          ) : (
                            <span className="text-fg-tertiary">—</span>
                          )}
                          {typeof row.erweitert === "string" && (
                            <span className="text-xs text-fg-secondary">
                              {row.erweitert}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Active capabilities for the user */}
          <Card>
            <CardHeader>
              <CardTitle>Aktivierte Funktionen für Ihren Account</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 md:grid-cols-2">
                {(isErweitert ? ERWEITERT_FEATURES : STANDARD_FEATURES).map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 rounded-md border border-border bg-bg-secondary/30 px-3 py-2 text-sm"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Verlauf der Upgrade-Anfragen</CardTitle>
            </CardHeader>
            <CardContent>
              <UpgradeHistory clinicId={session.clinicId} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const PLAN_MATRIX: Array<{
  feature: string;
  standard: boolean | string;
  erweitert: boolean | string;
}> = [
  { feature: "Anfrage-Posteingang", standard: true, erweitert: true },
  { feature: "KI-Score auf jeder Anfrage", standard: true, erweitert: true },
  { feature: "Werbeauswertung Live", standard: true, erweitert: true },
  { feature: "HWG-Vorab-Prüfung", standard: true, erweitert: true },
  { feature: "Animations-Bibliothek", standard: true, erweitert: true },
  { feature: "Reaktionszeit-SLA (Stunden)", standard: "24h", erweitert: "3h" },
  { feature: "Monatliche Strategie-Calls", standard: false, erweitert: true },
  { feature: "Animations-Anpassungen", standard: false, erweitert: true },
  { feature: "Vorrang-Support", standard: false, erweitert: true },
  { feature: "Detail-Modus im Portal", standard: true, erweitert: true },
  { feature: "Multi-Standort-Auswertung", standard: false, erweitert: true },
  { feature: "Landingpage A/B-Varianten", standard: false, erweitert: true },
];

function PlanCard({
  title,
  description,
  features,
  isActive,
  highlight,
}: {
  title: string;
  description: string;
  features: readonly string[];
  isActive: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 md:p-8 ${
        highlight
          ? "border-accent bg-accent/5"
          : "border-border bg-bg-secondary/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {isActive && <Badge tone="good">Aktiv</Badge>}
      </div>
      <p className="mt-2 text-base text-fg-primary">{description}</p>
      <ul className="mt-6 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-base">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function UpgradeHistory({ clinicId }: { clinicId: string }) {
  const rows = await db
    .select()
    .from(schema.upgradeRequests)
    .where(eq(schema.upgradeRequests.clinicId, clinicId))
    .orderBy(desc(schema.upgradeRequests.requestedAt));

  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-secondary">
        Bisher keine Upgrade-Anfragen.
      </p>
    );
  }

  return (
    <ul className="space-y-3 text-sm">
      {rows.map((r) => (
        <li
          key={r.id}
          className="rounded-lg border border-border bg-bg-secondary/30 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {formatDateTime(r.requestedAt)}
            </span>
            <Badge
              tone={
                r.status === "offen"
                  ? "warn"
                  : r.status === "bearbeitet"
                  ? "good"
                  : "neutral"
              }
            >
              {r.status}
            </Badge>
            {r.resolvedAt && (
              <span className="text-xs text-fg-secondary">
                · Bearbeitet {formatDateTime(r.resolvedAt)}
              </span>
            )}
          </div>
          {r.userNote && (
            <p className="mt-1 text-fg-primary">„{r.userNote}“</p>
          )}
          {r.karamNote && (
            <p className="mt-1 italic text-fg-secondary">
              Antwort: {r.karamNote}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
