import type { ReactNode } from "react";
import Link from "next/link";
import { TrendChart, cn, type TrendChartPoint, type TrendChartTone, type TrendChartValueFormat } from "@eins/ui";
import { formatClinicAggregate, formatEuro, formatNumber, formatRoas } from "@/lib/formatting";
import { zipSeries } from "@/lib/chart-data";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import type { MetricDelta, PlatformOverviewMetrics } from "@/server/queries/admin";
import { AdminDelta } from "./Panel";

/**
 * Month numbers. sm+: one tile per number on the page's thirds grid (same
 * gap-4 as the rows below, so the tile edges line up with the panels under
 * them). Phone: one hairline list, a compact row per number. `showAds=false`
 * (organic start, no ad data yet) drops the Werbebudget, Kosten je Anfrage
 * and Werbeertrag cells instead of rendering them as dashes.
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
    <section
      aria-label="Monatszahlen"
      className={cn(
        "grid gap-px overflow-hidden rounded-md border border-border bg-border",
        "sm:gap-4 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent",
        showAds ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-3"
      )}
    >
      <Cell
        href="/admin/clinics"
        linkLabel="Aktive Praxen ansehen"
        label="Aktive Praxen"
        value={`${data.activeClinics}/${data.totalClinics}`}
      />
      <Cell
        href="/admin/leistung"
        linkLabel="Werbeumsatz in Leistung ansehen"
        label={showAds ? "Werbeumsatz (Monat)" : "Umsatz (Monat)"}
        value={formatClinicAggregate(data.monthRevenue, data.revenueCurrencies)}
        delta={data.deltas.revenue}
        series={zipSeries(dates, data.sparklines.revenue)}
        chartLabel="Umsatz"
        valueFormat="euro"
      />
      {showAds && (
        <Cell
          href="/admin/leistung"
          linkLabel="Werbebudget in Leistung ansehen"
          label="Werbebudget (Monat)"
          value={formatEuro(data.monthSpend)}
          delta={data.deltas.spend}
          series={zipSeries(dates, data.sparklines.spend)}
          chartTone="neutral"
          chartLabel="Budget"
          valueFormat="euro"
        />
      )}
      <Cell
        href="/admin/leads"
        linkLabel="Anfragen ansehen"
        label="Anfragen (Monat)"
        value={formatNumber(data.monthLeads)}
        delta={data.deltas.leads}
        series={zipSeries(dates, data.sparklines.leads)}
        chartLabel="Anfragen"
        valueFormat="number"
      />
      {showAds && (
        <>
          <Cell
            href="/admin/leistung"
            linkLabel="Kosten je Anfrage in Leistung ansehen"
            label="Ø Kosten je Anfrage (Monat)"
            value={data.avgCpl == null ? "–" : formatEuro(data.avgCpl)}
            valueTone={cplTone}
            delta={data.deltas.cpl}
            hint={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
            series={zipSeries(dates, data.sparklines.cpl)}
            chartTone={cplTone === "neutral" ? "accent" : cplTone}
            chartLabel="Kosten je Anfrage"
            valueFormat="euro"
          />
          <Cell
            href="/admin/leistung"
            linkLabel="Werbeertrag in Leistung ansehen"
            label="Ø Werbeertrag (Monat)"
            value={formatRoas(data.avgRoas)}
            valueTone={roasTone}
            delta={data.deltas.roas}
            hint={`Ziel ≥ ${KPI_THRESHOLDS.roas.good}×`}
            series={zipSeries(dates, data.sparklines.roas)}
            chartTone={roasTone === "neutral" ? "accent" : roasTone}
            chartLabel="Werbeertrag"
            valueFormat="roas"
          />
        </>
      )}
    </section>
  );
}

function Cell({
  href,
  linkLabel,
  label,
  value,
  valueTone = "neutral",
  delta,
  hint,
  series,
  chartTone = "accent",
  chartLabel,
  valueFormat = "number",
}: {
  href: string;
  linkLabel: string;
  label: string;
  value: string;
  /** Target check (Kosten je Anfrage, Werbeertrag): colours the number. */
  valueTone?: "good" | "warn" | "bad" | "neutral";
  /** Change vs Vormonat; nothing at all when there is no comparison. */
  delta?: MetricDelta;
  /** Fixed context such as the target ("Ziel ≤ 40 €"). */
  hint?: ReactNode;
  series?: TrendChartPoint[];
  chartTone?: TrendChartTone;
  chartLabel?: string;
  valueFormat?: TrendChartValueFormat;
}) {
  const shownDelta = delta && !delta.suppressed && Math.abs(delta.value) >= 0.05 ? delta : null;
  // A line that sits on zero all month says nothing the 0 does not.
  const hasChart = series != null && series.length > 1 && series.some((p) => p.value !== 0);
  return (
    <div className="group relative flex min-w-0 items-center gap-4 bg-[var(--surface-tile)] px-4 py-3 transition-colors hover:bg-[var(--surface-tile-hover)] sm:flex-col sm:items-stretch sm:gap-0 sm:rounded-md sm:border sm:border-border sm:py-3.5">
      <Link
        href={href}
        aria-label={linkLabel}
        data-row
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      />
      {/* Phone: one compact row, numbers left and the line right. sm+: stacked. */}
      <div className="flex min-w-0 flex-1 flex-col sm:flex-none">
        <span className="truncate text-sm font-medium text-fg-primary">{label}</span>
        <span
          className={cn(
            "mt-1 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums",
            valueTone === "good" && "text-tone-good",
            valueTone === "warn" && "text-tone-warn",
            valueTone === "bad" && "text-tone-bad",
            valueTone === "neutral" && "text-fg-primary"
          )}
        >
          {value}
        </span>
        {(shownDelta || hint) && (
          <span className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-[13px] text-fg-secondary">
            {shownDelta && <AdminDelta delta={shownDelta} />}
            {/* A target hint takes the place of "vs. Vormonat" (the delta's
                tooltip still says it). */}
            {hint ?? (shownDelta && "vs. Vormonat")}
          </span>
        )}
      </div>
      {hasChart && (
        <div className="relative z-10 w-24 shrink-0 sm:mt-auto sm:w-auto sm:pt-3">
          <TrendChart
            data={series}
            tone={chartTone}
            label={chartLabel ?? label}
            valueFormat={valueFormat}
            height={36}
            filled={false}
          />
        </div>
      )}
    </div>
  );
}
