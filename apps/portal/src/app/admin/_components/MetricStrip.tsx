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
  "group block min-w-0 rounded-2xl transition-transform duration-200 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const TILE_INNER_CLASS =
  "h-full transition-colors duration-200 group-hover:border-accent-glow group-focus-visible:border-accent";

/**
 * `showAds=false` (organic start, no ad data yet) drops the Werbebudget, Kosten
 * je Anfrage and Werbeertrag tiles instead of rendering them as dashes.
 */
export function MetricStrip({
  data,
  showAds = true,
}: {
  data: PlatformOverviewMetrics;
  showAds?: boolean;
}) {
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
          label={showAds ? "Werbeumsatz (Monat)" : "Umsatz (Monat)"}
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
      {showAds && (
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
      )}
      <Link href="/admin/leads" className={TILE_LINK_CLASS} aria-label="Anfragen ansehen">
        <MetricTile
          label="Anfragen"
          value={formatNumber(data.monthLeads)}
          delta={data.deltas.leads}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.leads)}
              tone="accent"
              label="Anfragen"
              valueFormat="number"
            />
          }
          hint="vs. Vormonat"
          className={TILE_INNER_CLASS}
        />
      </Link>
      {showAds && (
        <>
      <Link href="/admin/leistung" className={TILE_LINK_CLASS} aria-label="Kosten je Anfrage in Leistung ansehen">
        <MetricTile
          label="Ø Kosten je Anfrage"
          value={data.avgCpl == null ? "–" : formatEuro(data.avgCpl)}
          delta={data.deltas.cpl}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.cpl)}
              tone={cplTone === "neutral" ? "accent" : cplTone}
              label="Kosten je Anfrage"
              valueFormat="euro"
            />
          }
          tone={cplTone}
          hint={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
          className={TILE_INNER_CLASS}
        />
      </Link>
      <Link href="/admin/leistung" className={TILE_LINK_CLASS} aria-label="Werbeertrag in Leistung ansehen">
        <MetricTile
          label="Ø Werbeertrag"
          value={data.avgRoas == null ? "–" : `${data.avgRoas.toFixed(2)}×`}
          delta={data.deltas.roas}
          chartSlot={
            <TrendChart
              data={zipSeries(dates, data.sparklines.roas)}
              tone={roasTone === "neutral" ? "accent" : roasTone}
              label="Werbeertrag"
              valueFormat="roas"
            />
          }
          tone={roasTone}
          hint={`Ziel ≥ ${KPI_THRESHOLDS.roas.good}×`}
          className={TILE_INNER_CLASS}
        />
      </Link>
        </>
      )}
    </div>
  );
}
