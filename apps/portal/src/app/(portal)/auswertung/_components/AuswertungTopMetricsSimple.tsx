import "server-only";
import { SimpleMetric } from "@eins/ui";
import {
  formatEuro,
  formatNumber,
  formatRoasSentence,
  toneForGoalRatio,
} from "@/lib/formatting";
import type { KpiSummary, currentGoals } from "@/server/queries/kpis";

type Goal = Awaited<ReturnType<typeof currentGoals>>[number];

export function AuswertungTopMetricsSimple({
  summary,
  periodKey,
  leadsGoal,
  revenueGoal,
}: {
  summary: KpiSummary;
  periodKey: string;
  leadsGoal: Goal | undefined;
  revenueGoal: Goal | undefined;
}) {
  return (
    <section aria-label="Kernzahlen" className="grid gap-6 md:grid-cols-3">
      <SimpleMetric
        label="Qualifizierte Anfragen"
        value={formatNumber(summary.qualifiedLeads)}
        tone={
          leadsGoal && periodKey === "month"
            ? toneForGoalRatio(summary.qualifiedLeads / Number(leadsGoal.targetValue))
            : "neutral"
        }
        explanation={
          leadsGoal && periodKey === "month"
            ? `Monatsziel: ${Number(leadsGoal.targetValue)} Anfragen.`
            : "Ernstgemeinte Patienten-Anfragen im Zeitraum."
        }
      />
      <SimpleMetric
        label="Umsatz"
        value={formatEuro(summary.revenueEur)}
        tone={
          revenueGoal && periodKey === "month"
            ? toneForGoalRatio(summary.revenueEur / Number(revenueGoal.targetValue))
            : "neutral"
        }
        explanation={
          revenueGoal && periodKey === "month"
            ? `Monatsziel: ${formatEuro(Number(revenueGoal.targetValue))}.`
            : formatRoasSentence(summary.roas)
        }
      />
      <SimpleMetric
        label="Werbebudget"
        value={formatEuro(summary.spendEur)}
        tone="neutral"
        explanation={formatRoasSentence(summary.roas)}
      />
    </section>
  );
}
