import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { currentMonthSummary } from "@/server/queries/kpis";
import { WhatIfCalculator } from "./Calculator";

export const metadata = { title: "Was wäre wenn" };

/**
 * Scenario calculator. Starts from the clinic's actual last-month numbers
 * and lets the user toy with sliders to see projected impact.
 *
 * Deliberately simple math — we're giving orientation, not a forecast.
 */
export default async function WasWaereWennPage() {
  const session = await requirePermissionOrRedirect("tools.what_if");
  const baseline = await currentMonthSummary(session.clinicId, session.userId);

  // Fallback baseline for empty clinics so sliders start with sensible values.
  const defaults = {
    qualifiedLeads: baseline.qualifiedLeads > 0 ? baseline.qualifiedLeads : 40,
    appointments: baseline.appointments > 0 ? baseline.appointments : 28,
    consultationsHeld:
      baseline.consultationsHeld > 0 ? baseline.consultationsHeld : 22,
    casesWon: baseline.casesWon > 0 ? baseline.casesWon : 6,
    spendEur: baseline.spendEur > 0 ? baseline.spendEur : 4000,
    revenueEur: baseline.revenueEur > 0 ? baseline.revenueEur : 18000,
  };

  // Derived rates that the calculator uses as defaults.
  const defaultAvgCaseValue =
    defaults.casesWon > 0
      ? Math.round(defaults.revenueEur / defaults.casesWon)
      : 3000;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Was wäre, wenn …</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Spielen Sie durch, was passiert, wenn Sie das Budget erhöhen, die
          Reaktionszeit verbessern oder schneller einen Termin vereinbaren.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Ihre Ausgangslage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Stat label="Anfragen" value={defaults.qualifiedLeads} unit="" />
            <Stat label="Termine" value={defaults.appointments} unit="" />
            <Stat label="Beratungen" value={defaults.consultationsHeld} unit="" />
            <Stat label="Behandlungen" value={defaults.casesWon} unit="" />
            <Stat label="Budget" value={defaults.spendEur} unit="€" />
            <Stat label="Umsatz" value={defaults.revenueEur} unit="€" />
            <Stat
              label="Ø Umsatz / Fall"
              value={defaultAvgCaseValue}
              unit="€"
            />
            <Stat
              label="Abschlussquote"
              value={
                defaults.consultationsHeld > 0
                  ? Math.round(
                      (defaults.casesWon / defaults.consultationsHeld) * 100
                    )
                  : 0
              }
              unit="%"
            />
          </div>
          {baseline.qualifiedLeads === 0 && (
            <p className="mt-3 text-sm text-fg-secondary">
              Noch keine Monatszahlen vorhanden — wir rechnen mit sinnvollen
              Beispielwerten, damit Sie die Größenordnung sehen.
            </p>
          )}
        </CardContent>
      </Card>

      <WhatIfCalculator
        baseline={{
          leads: defaults.qualifiedLeads,
          appointments: defaults.appointments,
          consultations: defaults.consultationsHeld,
          casesWon: defaults.casesWon,
          spendEur: defaults.spendEur,
          revenueEur: defaults.revenueEur,
          avgCaseEur: defaultAvgCaseValue,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Wie die Rechnung funktioniert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-base text-fg-primary">
          <p>
            Die Rechnung geht von Ihren Ist-Quoten aus: Anfrage zu Termin,
            Termin zu Beratung, Beratung zu Behandlung. Wenn Sie das Budget
            erhöhen, steigt die Zahl der Anfragen proportional.
          </p>
          <p>
            Die Quoten ändern sich nicht automatisch mit dem Budget. Wenn Sie
            etwa schneller reagieren, verbessert sich die Termin-Quote messbar
            — das können Sie mit dem entsprechenden Regler simulieren.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums">
        {value.toLocaleString("de-DE")} {unit}
      </div>
    </div>
  );
}
