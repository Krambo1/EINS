import Link from "next/link";
import { Card, CardContent, TrendChart, Donut } from "@eins/ui";
import {
  formatClinicAggregate,
  formatEuro,
  formatMoney,
  formatNumber,
  formatRoas,
} from "@/lib/formatting";
import {
  spendRevenueSeries,
  clinicLeaderboard,
  type ClinicLeaderboardRow,
} from "@/server/queries/admin";
import { AdminTable, type AdminColumn } from "../../_components/AdminTable";

export const REVENUE_PERIODS: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};
export const DEFAULT_REVENUE_PERIOD = "90d";

const REVENUE_PALETTE = [
  "var(--accent)",
  "var(--tone-good)",
  "var(--tone-warn)",
  "#1877F2",
  "#EA4335",
];
const REST_COLOR = "var(--fg-tertiary)";

type RevenuePeriodData = {
  days: number;
  series: Awaited<ReturnType<typeof spendRevenueSeries>>;
  leaderboard: ClinicLeaderboardRow[];
};

/** The reads behind the period-dependent part of /admin/revenue. */
export async function loadRevenuePeriod(periodKey: string): Promise<RevenuePeriodData> {
  const days = REVENUE_PERIODS[periodKey] ?? REVENUE_PERIODS[DEFAULT_REVENUE_PERIOD]!;
  const [series, leaderboard] = await Promise.all([
    // Pull double the window so we can split into current + prior period for
    // the Vorperiode comparison line.
    spendRevenueSeries(days * 2),
    clinicLeaderboard({ periodDays: days, realOnly: true }),
  ]);
  return { days, series, leaderboard };
}

/**
 * The period-dependent part of /admin/revenue: the trend against the prior
 * period, the donut and the table per Praxis. Rendered by the page for the
 * period in the URL and by `loadAdminRevenue` (range-actions.tsx) for the
 * others.
 */
export function RevenuePeriodBody({ days, series, leaderboard }: RevenuePeriodData) {
  const priorHalf = series.slice(0, days);
  const currentHalf = series.slice(days);
  const revenuePoints = currentHalf.map((p) => ({ date: p.date, value: p.revenueEur }));
  const priorPoints = priorHalf.map((p) => ({ date: p.date, value: p.revenueEur }));

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
      render: (c) => <span className="tabular-nums">{formatMoney(c.revenueEur, c.currency)}</span>,
    },
    {
      key: "spend",
      align: "right",
      header: "Werbebudget",
      render: (c) => <span className="tabular-nums">{formatEuro(c.spendEur)}</span>,
    },
    {
      key: "roas",
      align: "right",
      header: "Werbeertrag",
      render: (c) => (
        <span className="tabular-nums">{formatRoas(c.roas)}</span>
      ),
    },
    {
      key: "leads",
      align: "right",
      secondary: true,
      detailLabel: "Anfragen",
      header: "Anfragen",
      render: (c) => formatNumber(c.leads),
    },
    {
      key: "cases",
      align: "right",
      secondary: true,
      detailLabel: "Abschlüsse",
      header: "Abschlüsse",
      render: (c) => formatNumber(c.casesWon),
    },
  ];

  return (
    <>
    <Card>
      <CardContent className="space-y-4 pt-6">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-medium md:text-2xl">
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
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">Umsatz je Praxis</h2>
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

      <Card className="!p-0 overflow-hidden">
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
    </>
  );
}
