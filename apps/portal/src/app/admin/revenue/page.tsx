import { MetricTile } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatClinicAggregate, formatEuro, formatRoas } from "@/lib/formatting";
import { platformOverviewMetrics } from "@/server/queries/admin";
import { ParamLink, ParamViews, ParamViewsSlot } from "@/app/_components/instant-views";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { loadAdminRevenue } from "../range-actions";
import {
  DEFAULT_REVENUE_PERIOD,
  REVENUE_PERIODS,
  RevenuePeriodBody,
  loadRevenuePeriod,
} from "./_components/RevenuePeriodBody";

export const metadata = { title: "Umsatz · Admin" };

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function AdminRevenuePage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const periodKey =
    params.period && params.period in REVENUE_PERIODS ? params.period : DEFAULT_REVENUE_PERIOD;

  // The month tiles do not depend on the period; the period switch swaps
  // only the part below them (kept views, instant-views.tsx).
  const [overview, data] = await Promise.all([
    platformOverviewMetrics(),
    loadRevenuePeriod(periodKey),
  ]);

  const netMargin =
    overview.monthRevenue > 0
      ? ((overview.monthRevenue - overview.monthSpend) / overview.monthRevenue) * 100
      : null;

  return (
    <ParamViews
      param="period"
      values={Object.keys(REVENUE_PERIODS)}
      defaultValue={DEFAULT_REVENUE_PERIOD}
      load={loadAdminRevenue}
    >
      <div className="space-y-8">
        <AdminPageHeader
          title="Umsatz & Werbeertrag"
          subtitle="Werbeumsatz über alle Praxen, Trend gegen die Vorperiode und Umsatz je Praxis. Monatswerte reconcilen mit der Übersicht."
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">
            Zeitraum
          </span>
          {Object.entries(REVENUE_PERIODS).map(([k, d]) => (
            <ParamLink
              key={k}
              param="period"
              value={k}
              href={`/admin/revenue?period=${k}`}
              className="rounded-full border px-3 py-1 text-xs transition-colors"
              activeClassName="border-accent bg-fg-primary text-bg-primary"
              inactiveClassName="border-border text-fg-secondary hover:border-accent hover:text-accent"
            >
              {d} Tage
            </ParamLink>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Werbeumsatz (Monat)"
            value={formatClinicAggregate(overview.monthRevenue, overview.revenueCurrencies)}
            delta={overview.deltas.revenue}
            hint="vs. Vormonat"
            tone="accent"
          />
          <MetricTile
            label="Ø Werbeertrag"
            value={formatRoas(overview.avgRoas)}
            delta={overview.deltas.roas}
            hint="Umsatz je Euro Werbebudget"
          />
          <MetricTile
            label="Werbebudget (Monat)"
            value={formatEuro(overview.monthSpend)}
            delta={overview.deltas.spend}
            hint="vs. Vormonat"
          />
          <MetricTile
            label="Nettomarge"
            value={netMargin == null ? "–" : `${netMargin.toFixed(0)} %`}
            sublabel={`${formatClinicAggregate(
              overview.monthRevenue - overview.monthSpend,
              overview.revenueCurrencies
            )} Differenz`}
            tone={netMargin != null && netMargin >= 0 ? "good" : "bad"}
          />
        </div>

        <ParamViewsSlot param="period" value={periodKey} className="space-y-8">
          <RevenuePeriodBody {...data} />
        </ParamViewsSlot>
      </div>
    </ParamViews>
  );
}
