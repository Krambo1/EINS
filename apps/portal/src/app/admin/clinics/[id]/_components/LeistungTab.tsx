import Link from "next/link";
import { Card, CardContent, MetricTile, Badge, TrendChart, Donut } from "@eins/ui";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
} from "@/lib/formatting";
import { REQUEST_STATUS_LABELS } from "@/lib/constants";
import { reportingChannelLabel } from "@/lib/sources";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import type { ClinicPerformance } from "@/server/queries/admin";
import { withBrandLogos } from "@/app/_components/Brand";
import { FunnelBar } from "../../../_charts/FunnelBar";

const PERIOD_OPTIONS: { key: string; label: string; days: number }[] = [
  { key: "30d", label: "30 Tage", days: 30 },
  { key: "90d", label: "90 Tage", days: 90 },
  { key: "180d", label: "Halbjahr", days: 180 },
  { key: "365d", label: "Jahr", days: 365 },
];

const GOAL_METRIC_LABEL: Record<string, string> = {
  leads: "Anfragen",
  total_requests: "Anfragen gesamt",
  revenue: "Umsatz",
  cases_won: "Gewonnene Patienten",
  appointments: "Termine",
  spend: "Werbebudget",
};

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  csv: "CSV-Import",
};

const PLATFORM_COLOR: Record<string, string> = {
  meta: "#1877F2",
  google: "#EA4335",
  csv: "#94a3b8",
};

interface Props {
  perf: ClinicPerformance;
  periodKey: string;
  clinicId: string;
}

export function LeistungTab({ perf, periodKey, clinicId }: Props) {
  const { summary, daily, bySource, byPlatform, funnel, goals, currency } = perf;
  const spendPoints = daily.map((d) => ({ date: d.date, value: d.spendEur }));
  const revenuePoints = daily.map((d) => ({ date: d.date, value: d.revenueEur }));
  const cplTone = toneForLowerBetter(summary.cpl, KPI_THRESHOLDS.cpl);
  const roasTone = toneForHigherBetter(summary.roas, KPI_THRESHOLDS.roas);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg-primary">
          Zeitraum
        </span>
        {PERIOD_OPTIONS.map((p) => (
          <Link
            key={p.key}
            href={{
              pathname: `/admin/clinics/${clinicId}`,
              query: { tab: "leistung", period: p.key },
            }}
            scroll={false}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              p.key === periodKey
                ? "border-accent bg-fg-primary text-bg-primary"
                : "border-border text-fg-primary hover:border-accent hover:text-accent"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Werbebudget"
          value={formatEuro(summary.spendEur)}
          sublabel={`${formatNumber(summary.leads)} Anfragen`}
        />
        <MetricTile
          label="Umsatz"
          value={formatMoney(summary.revenueEur, currency)}
          sublabel={`${formatNumber(summary.casesWon)} gewonnen`}
          tone="accent"
        />
        <MetricTile
          label="Kosten je Anfrage"
          value={summary.cpl == null ? "–" : formatEuro(summary.cpl)}
          sublabel={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
          tone={cplTone}
        />
        <MetricTile
          label="Werbeertrag"
          value={summary.roas == null ? "–" : `${summary.roas.toFixed(2)}×`}
          sublabel={summary.cpp == null ? "" : `Kosten pro Patient ${formatEuro(summary.cpp)}`}
          tone={roasTone}
        />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">
            Werbebudget und Umsatz
          </h2>
          <div className="rounded-xl border border-border bg-bg-primary p-3">
            <TrendChart
              data={spendPoints}
              series={[
                { points: spendPoints, tone: "neutral", label: "Werbebudget", filled: true },
                { points: revenuePoints, tone: "accent", label: "Werbeumsatz", filled: true },
              ]}
              height={240}
              showAxes
              showGrid
              valueFormat="euro"
              ariaLabel="Werbebudget und Werbeumsatz"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-xl font-medium md:text-2xl">Quellen</h2>
            {bySource.length === 0 ? (
              <p className="text-sm text-fg-primary">
                Keine Anfragen in diesem Zeitraum.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-sm font-medium text-fg-primary">
                  <tr>
                    <th className="py-2">Quelle</th>
                    <th className="py-2 text-right">Anfragen</th>
                    <th className="py-2 text-right">Umsatz</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.map((s) => (
                    <tr key={s.source} className="border-t border-border">
                      <td className="py-2">
                        {withBrandLogos(reportingChannelLabel(s.source))}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatNumber(s.leads)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatMoney(s.revenueEur, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-xl font-medium md:text-2xl">Plattformen</h2>
            <Donut
              slices={byPlatform.map((p) => ({
                name: PLATFORM_LABEL[p.platform] ?? p.platform,
                value: p.spendEur,
                color: PLATFORM_COLOR[p.platform] ?? "#cbd5e1",
              }))}
              centerLabel={formatEuro(summary.spendEur)}
              centerSubLabel="Werbebudget"
              valueFormat="euro"
              height={200}
            />
            <div className="space-y-1 text-xs">
              {byPlatform.map((p) => (
                <div key={p.platform} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: PLATFORM_COLOR[p.platform] }}
                    aria-hidden
                  />
                  <span className="flex-1">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                  <span className="tabular-nums text-fg-secondary">
                    {formatEuro(p.spendEur)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">Strecke</h2>
          <FunnelBar
            stages={funnel.map((b) => ({
              label: REQUEST_STATUS_LABELS[b.status] ?? b.status,
              count: b.count,
              tone:
                b.status === "gewonnen"
                  ? "good"
                  : b.status === "verloren" || b.status === "spam"
                    ? "bad"
                    : b.status === "neu"
                      ? "neutral"
                      : "accent",
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">Ziele</h2>
          {goals.length === 0 ? (
            <p className="text-sm text-fg-primary">
              Keine aktiven Ziele für diese Praxis.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-sm font-medium text-fg-primary">
                <tr>
                  <th className="py-2">Ziel</th>
                  <th className="py-2 text-right">Aktuell</th>
                  <th className="py-2 text-right">Ziel</th>
                  <th className="py-2 text-right">Fortschritt</th>
                  <th className="py-2 text-right">Zeitraum</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((g) => {
                  const ratio = g.targetValue > 0 ? g.currentValue / g.targetValue : 0;
                  const tone =
                    ratio >= 1 ? "good" : ratio >= 0.7 ? "warn" : ratio >= 0.4 ? "neutral" : "bad";
                  return (
                    <tr key={g.metric + g.periodStart} className="border-t border-border">
                      <td className="py-2">
                        {GOAL_METRIC_LABEL[g.metric] ?? g.metric}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {g.metric === "revenue"
                          ? formatMoney(g.currentValue, currency)
                          : formatNumber(g.currentValue)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {g.metric === "revenue"
                          ? formatMoney(g.targetValue, currency)
                          : formatNumber(g.targetValue)}
                      </td>
                      <td className="py-2 text-right">
                        <Badge tone={tone}>{formatPercent(Math.min(ratio, 2))}</Badge>
                      </td>
                      <td className="py-2 text-right text-xs tabular-nums text-fg-secondary">
                        {g.periodStart} → {g.periodEnd}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
