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

/**
 * Base SimpleMetric grid — always cheap to render, no extra DB queries.
 * Used as the immediate paint AND as the Suspense fallback for the
 * detail-mode enhanced grid. The visual swap when detail data arrives
 * is intentional: TTFB + first-paint matters more than the swap blip.
 */
export function DashboardTopMetricsSimple({
  summary,
  slaBreaches,
  openRequests,
  leadsGoal,
  revenueGoal,
}: {
  summary: KpiSummary;
  slaBreaches: number;
  openRequests: number;
  leadsGoal: Goal | undefined;
  revenueGoal: Goal | undefined;
}) {
  return (
    <section aria-label="Monatszahlen" className="grid gap-4 md:grid-cols-3">
      <SimpleMetric
        label="Qualifizierte Anfragen"
        value={formatNumber(summary.qualifiedLeads)}
        tone={
          leadsGoal
            ? toneForGoalRatio(summary.qualifiedLeads / Number(leadsGoal.targetValue))
            : "neutral"
        }
        explanation={
          leadsGoal
            ? `Monatsziel: ${Number(leadsGoal.targetValue)} Anfragen.`
            : "Ernstgemeinte Anfragen im laufenden Monat."
        }
      />
      <SimpleMetric
        label="Umsatz in diesem Monat"
        value={formatEuro(summary.revenueEur)}
        tone={
          revenueGoal
            ? toneForGoalRatio(summary.revenueEur / Number(revenueGoal.targetValue))
            : "neutral"
        }
        explanation={
          revenueGoal
            ? `Monatsziel: ${formatEuro(Number(revenueGoal.targetValue))}.`
            : formatRoasSentence(summary.roas)
        }
      />
      <SimpleMetric
        label="Offene Anfragen"
        value={formatNumber(openRequests)}
        tone={slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good"}
        explanation={
          slaBreaches > 0
            ? `${slaBreaches} davon überfällig. Bitte heute anrufen.`
            : openRequests > 0
            ? "Diese Anfragen warten auf eine erste Reaktion."
            : "Alles auf aktuellem Stand."
        }
      />
    </section>
  );
}
