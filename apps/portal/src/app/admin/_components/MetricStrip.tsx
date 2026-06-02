import Link from "next/link";
import { MetricTile, TrendChart } from "@eins/ui";
import { formatClinicAggregate, formatEuro, formatNumber } from "@/lib/formatting";
import { zipSeries } from "@/lib/chart-data";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import type { PlatformOverviewMetrics } from "@/server/queries/admin";

const TILE_LINK_CLASS =
  "group block rounded-2xl transition-transform duration-200 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const TILE_INNER_CLASS =
  "h-full transition-colors duration-200 group-hover:border-accent/40 group-focus-visible:border-accent/40";

export function MetricStrip({ data }: { data: PlatformOverviewMetrics }) {
  const cplTone = toneForLowerBetter(data.avgCpl, KPI_THRESHOLDS.cpl);
  const roasTone = toneForHigherBetter(data.avgRoas, KPI_THRESHOLDS.roas);
  const dates = data.sparklines.dates;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Link href="/admin/clinics" className={TILE_LINK_CLASS} aria-label="Aktive Praxen ansehen">
        <MetricTile
          label="Aktive Praxen"
          value={`${data.activeClinics}/${data.totalClinics}`}
          sublabel="Nicht archiviert · gesamt"
          tone="accent"
          className={TILE_INNER_CLASS}
        />
      </Link>
      <Link href="/admin/leistung" className={TILE_LINK_CLASS} aria-label="Werbeumsatz in Leistung ansehen">
        <MetricTile
          label="Werbeumsatz (Monat)"
          value={formatClinicAggregate(data.monthRevenue, data.revenueCurrencies)}
          delta={data.deltas.revenue}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.revenue)}
              tone="accent"
              label="Umsatz"
              valueFormat="euro"
            />
          }
          tone="accent"
          hint="vs. Vormonat"
          className={TILE_INNER_CLASS}
        />
      </Link>
      <Link href="/admin/leistung" className={TILE_LINK_CLASS} aria-label="Werbebudget in Leistung ansehen">
        <MetricTile
          label="Werbebudget (Monat)"
          value={formatEuro(data.monthSpend)}
          delta={data.deltas.spend}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.spend)}
              tone="neutral"
              label="Budget"
              valueFormat="euro"
            />
          }
          hint="vs. Vormonat"
          className={TILE_INNER_CLASS}
        />
      </Link>
      <Link href="/admin/leads" className={TILE_LINK_CLASS} aria-label="Anfragen ansehen">
        <MetricTile
          label="Anfragen"
          value={formatNumber(data.monthLeads)}
          delta={data.deltas.leads}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.leads)}
              tone="accent"
              label="Leads"
              valueFormat="number"
            />
          }
          hint="vs. Vormonat"
          className={TILE_INNER_CLASS}
        />
      </Link>
      <Link href="/admin/leistung" className={TILE_LINK_CLASS} aria-label="CPL in Leistung ansehen">
        <MetricTile
          label="Ø CPL"
          value={data.avgCpl == null ? "–" : formatEuro(data.avgCpl)}
          delta={data.deltas.cpl}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.cpl)}
              tone={cplTone === "neutral" ? "accent" : cplTone}
              label="CPL"
              valueFormat="euro"
            />
          }
          tone={cplTone}
          hint={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
          className={TILE_INNER_CLASS}
        />
      </Link>
      <Link href="/admin/leistung" className={TILE_LINK_CLASS} aria-label="ROAS in Leistung ansehen">
        <MetricTile
          label="Ø ROAS"
          value={data.avgRoas == null ? "–" : `${data.avgRoas.toFixed(2)}×`}
          delta={data.deltas.roas}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.roas)}
              tone={roasTone === "neutral" ? "accent" : roasTone}
              label="ROAS"
              valueFormat="roas"
            />
          }
          tone={roasTone}
          hint={`Ziel ≥ ${KPI_THRESHOLDS.roas.good}×`}
          className={TILE_INNER_CLASS}
        />
      </Link>
    </div>
  );
}
