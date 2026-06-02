import Link from "next/link";
import { Card, CardContent, MetricTile, TrendChart, Donut } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import {
  formatClinicAggregate,
  formatEuro,
  formatMoney,
  formatNumber,
} from "@/lib/formatting";
import {
  platformOverviewMetrics,
  spendRevenueSeries,
  clinicLeaderboard,
  type ClinicLeaderboardRow,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AdminTable, type AdminColumn } from "../_components/AdminTable";

export const metadata = { title: "Umsatz · Admin" };

const GLOW_CARD = "!bg-bg-secondary";

const PERIODS: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

const REVENUE_PALETTE = [
  "var(--accent)",
  "var(--tone-good)",
  "var(--tone-warn)",
  "#1877F2",
  "#EA4335",
];
const REST_COLOR = "var(--fg-tertiary)";

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function AdminRevenuePage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const periodKey = params.period ?? "90d";
  const days = PERIODS[periodKey] ?? 90;

  const [overview, series, leaderboard] = await Promise.all([
    platformOverviewMetrics(),
    // Pull double the window so we can split into current + prior period for
    // the Vorperiode comparison line.
    spendRevenueSeries(days * 2),
    clinicLeaderboard({ periodDays: days }),
  ]);

  const priorHalf = series.slice(0, days);
  const currentHalf = series.slice(days);
  const revenuePoints = currentHalf.map((p) => ({ date: p.date, value: p.revenueEur }));
  const priorPoints = priorHalf.map((p) => ({ date: p.date, value: p.revenueEur }));

  const netMargin =
    overview.monthRevenue > 0
      ? ((overview.monthRevenue - overview.monthSpend) / overview.monthRevenue) * 100
      : null;

  // Revenue-by-Praxis donut: top 5 + "Übrige".
  const byRevenue = [...leaderboard]
    .filter((c) => c.revenueEur > 0)
    .sort((a, b) => b.revenueEur - a.revenueEur);
  const topClinics = byRevenue.slice(0, 5);
  const restRevenue = byRevenue.slice(5).reduce((acc, c) => acc + c.revenueEur, 0);
  const donutSlices = [
    ...topClinics.map((c, i) => ({
      name: c.name,
      value: c.revenueEur,
      color: REVENUE_PALETTE[i] ?? REST_COLOR,
    })),
    ...(restRevenue > 0
      ? [{ name: "Übrige Praxen", value: restRevenue, color: REST_COLOR }]
      : []),
  ];
  const totalRevenue = byRevenue.reduce((acc, c) => acc + c.revenueEur, 0);

  const leaderboardRows = [...leaderboard].sort((a, b) => b.revenueEur - a.revenueEur);

  const columns: AdminColumn<ClinicLeaderboardRow>[] = [
    {
      key: "name",
      header: "Praxis",
      render: (c) => (
        <Link
          href={`/admin/clinics/${c.clinicId}?tab=leistung`}
          className="font-medium text-fg-primary hover:text-accent"
        >
          {c.name}
        </Link>
      ),
    },
    {
      key: "revenue",
      align: "right",
      header: "Umsatz",
      render: (c) => <span className="font-mono">{formatMoney(c.revenueEur, c.currency)}</span>,
    },
    {
      key: "spend",
      align: "right",
      header: "Werbebudget",
      render: (c) => <span className="font-mono">{formatEuro(c.spendEur)}</span>,
    },
    {
      key: "roas",
      align: "right",
      header: "ROAS",
      render: (c) => (
        <span className="font-mono">{c.roas == null ? "–" : `${c.roas.toFixed(2)}×`}</span>
      ),
    },
    {
      key: "leads",
      align: "right",
      secondary: true,
      detailLabel: "Leads",
      header: "Leads",
      render: (c) => formatNumber(c.leads),
    },
    {
      key: "cases",
      align: "right",
      secondary: true,
      detailLabel: "Cases gewonnen",
      header: "Cases",
      render: (c) => formatNumber(c.casesWon),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Umsatz & Werbeertrag"
        subtitle="Werbeumsatz über alle Praxen, Trend gegen die Vorperiode und Umsatz je Praxis. Monatswerte reconcilen mit der Übersicht."
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          Zeitraum
        </span>
        {Object.entries(PERIODS).map(([k, d]) => (
          <Link
            key={k}
            href={{ pathname: "/admin/revenue", query: { period: k } }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              k === periodKey
                ? "border-accent bg-fg-primary text-bg-primary"
                : "border-border text-fg-secondary hover:border-accent hover:text-accent"
            }`}
          >
            {d} Tage
          </Link>
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
          label="Ø ROAS"
          value={overview.avgRoas == null ? "–" : `${overview.avgRoas.toFixed(2)}×`}
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

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <header className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">
              Umsatzverlauf · {days} Tage
            </h2>
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden />
                Aktuell
              </span>
              <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                <span
                  className="inline-block h-[3px] w-4 rounded-full"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(90deg, var(--fg-tertiary) 0 3px, transparent 3px 6px)",
                  }}
                  aria-hidden
                />
                Vorperiode
              </span>
            </div>
          </header>
          <div className="rounded-xl border border-border bg-bg-primary p-3">
            <TrendChart
              data={revenuePoints}
              comparisonData={priorPoints}
              comparisonLabel="Vorperiode"
              tone="accent"
              height={260}
              filled
              showAxes
              showGrid
              valueFormat="euro"
              label="Umsatz"
              ariaLabel={`Werbeumsatz über ${days} Tage gegen die Vorperiode`}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <Card className={GLOW_CARD}>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-display text-xl font-semibold">Umsatz je Praxis</h2>
            <p className="text-xs text-fg-secondary">Top 5 nach Werbeumsatz · {days} Tage</p>
            <Donut
              slices={donutSlices}
              centerLabel={formatClinicAggregate(
                totalRevenue,
                byRevenue.map((c) => c.currency)
              )}
              centerSubLabel="Umsatz gesamt"
              valueFormat="euro"
              showLegend
              height={200}
            />
          </CardContent>
        </Card>

        <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
          <CardContent className="p-0">
            <AdminTable
              columns={columns}
              rows={leaderboardRows}
              getRowKey={(c) => c.clinicId}
              empty="Noch keine Umsatzdaten im Zeitraum."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
