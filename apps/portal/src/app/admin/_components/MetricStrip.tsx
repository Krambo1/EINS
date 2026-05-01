import { MetricTile } from "@eins/ui";
import { formatEuro, formatNumber } from "@/lib/formatting";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import type { PlatformOverviewMetrics } from "@/server/queries/admin";

export function MetricStrip({ data }: { data: PlatformOverviewMetrics }) {
  const cplTone = toneForLowerBetter(data.avgCpl, KPI_THRESHOLDS.cpl);
  const roasTone = toneForHigherBetter(data.avgRoas, KPI_THRESHOLDS.roas);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <MetricTile
        label="Aktive Kliniken"
        value={`${data.activeClinics}/${data.totalClinics}`}
        sublabel="Nicht archiviert · gesamt"
        tone="accent"
      />
      <MetricTile
        label="Werbeumsatz (Monat)"
        value={formatEuro(data.monthRevenue)}
        delta={data.deltas.revenue}
        sparkline={data.sparklines.revenue}
        sparklineTone="accent"
        tone="accent"
        hint="vs. Vormonat"
      />
      <MetricTile
        label="Werbebudget (Monat)"
        value={formatEuro(data.monthSpend)}
        delta={data.deltas.spend}
        sparkline={data.sparklines.spend}
        sparklineTone="neutral"
        hint="vs. Vormonat"
      />
      <MetricTile
        label="Qualifizierte Leads"
        value={formatNumber(data.monthLeads)}
        delta={data.deltas.leads}
        sparkline={data.sparklines.leads}
        sparklineTone="accent"
        hint="vs. Vormonat"
      />
      <MetricTile
        label="Ø CPL"
        value={data.avgCpl == null ? "–" : formatEuro(data.avgCpl)}
        delta={data.deltas.cpl}
        sparkline={data.sparklines.cpl}
        tone={cplTone}
        hint={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
      />
      <MetricTile
        label="Ø ROAS"
        value={data.avgRoas == null ? "–" : `${data.avgRoas.toFixed(2)}×`}
        delta={data.deltas.roas}
        sparkline={data.sparklines.roas}
        tone={roasTone}
        hint={`Ziel ≥ ${KPI_THRESHOLDS.roas.good}×`}
      />
    </div>
  );
}
