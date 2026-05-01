import Link from "next/link";
import { Card, CardContent, MetricTile, Badge } from "@eins/ui";
import {
  formatEuro,
  formatNumber,
  formatPercent,
} from "@/lib/formatting";
import {
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type RequestSource,
} from "@/lib/constants";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import type { ClinicPerformance } from "@/server/queries/admin";
import { AreaChart } from "../../../_charts/AreaChart";
import { Donut } from "../../../_charts/Donut";
import { FunnelBar } from "../../../_charts/FunnelBar";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";
const PERIOD_OPTIONS: { key: string; label: string; days: number }[] = [
  { key: "30d", label: "30 Tage", days: 30 },
  { key: "90d", label: "90 Tage", days: 90 },
  { key: "180d", label: "Halbjahr", days: 180 },
  { key: "365d", label: "Jahr", days: 365 },
];

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
  const { summary, daily, bySource, byPlatform, funnel, goals } = perf;
  const cplTone = toneForLowerBetter(summary.cpl, KPI_THRESHOLDS.cpl);
  const cppTone = toneForLowerBetter(summary.cpp, KPI_THRESHOLDS.cpp);
  const roasTone = toneForHigherBetter(summary.roas, KPI_THRESHOLDS.roas);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
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
            className={`rounded-full border px-3 py-1 text-xs ${
              p.key === periodKey
                ? "border-accent bg-accent text-white"
                : "border-border text-fg-secondary hover:border-accent hover:text-accent"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Spend"
          value={formatEuro(summary.spendEur)}
          sublabel={`${formatNumber(summary.leads)} Leads`}
        />
        <MetricTile
          label="Umsatz"
          value={formatEuro(summary.revenueEur)}
          sublabel={`${formatNumber(summary.casesWon)} gewonnen`}
          tone="accent"
        />
        <MetricTile
          label="CPL"
          value={summary.cpl == null ? "–" : formatEuro(summary.cpl)}
          sublabel={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
          tone={cplTone}
        />
        <MetricTile
          label="ROAS"
          value={summary.roas == null ? "–" : `${summary.roas.toFixed(2)}×`}
          sublabel={summary.cpp == null ? "" : `CPP ${formatEuro(summary.cpp)}`}
          tone={roasTone}
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Spend &amp; Umsatz
          </h2>
          <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
            <AreaChart
              data={daily.map((d) => ({
                date: d.date,
                spend: d.spendEur,
                revenue: d.revenueEur,
              }))}
              series={[
                { key: "spend", name: "Werbebudget", color: "#94a3b8" },
                { key: "revenue", name: "Werbeumsatz", color: "var(--accent)" },
              ]}
              height={260}
              yKind="eur"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className={GLOW_CARD}>
          <CardContent className="space-y-4 pt-6">
            <h2 className="font-display text-xl font-semibold">Quellen</h2>
            {bySource.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                Keine Anfragen in diesem Zeitraum.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-secondary">
                  <tr>
                    <th className="py-2">Quelle</th>
                    <th className="py-2 text-right">Leads</th>
                    <th className="py-2 text-right">Umsatz</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.map((s) => (
                    <tr key={s.source} className="border-t border-border">
                      <td className="py-2">
                        {SOURCE_LABELS[s.source as RequestSource] ?? s.source}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {formatNumber(s.leads)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {formatEuro(s.revenueEur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className={GLOW_CARD}>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-display text-xl font-semibold">Plattformen</h2>
            <Donut
              slices={byPlatform.map((p) => ({
                name: p.platform.toUpperCase(),
                value: p.spendEur,
                color: PLATFORM_COLOR[p.platform] ?? "#cbd5e1",
              }))}
              centerLabel={formatEuro(summary.spendEur)}
              centerSubLabel="Spend"
              valueKind="eur"
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
                  <span className="flex-1 capitalize">{p.platform}</span>
                  <span className="font-mono tabular-nums text-fg-secondary">
                    {formatEuro(p.spendEur)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">Funnel</h2>
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

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">Ziele</h2>
          {goals.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Keine aktiven Ziele für diese Klinik.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
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
                      <td className="py-2 capitalize">
                        {g.metric.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {g.metric === "revenue"
                          ? formatEuro(g.currentValue)
                          : formatNumber(g.currentValue)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {g.metric === "revenue"
                          ? formatEuro(g.targetValue)
                          : formatNumber(g.targetValue)}
                      </td>
                      <td className="py-2 text-right">
                        <Badge tone={tone}>{formatPercent(Math.min(ratio, 2))}</Badge>
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums text-fg-secondary">
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
