import { Card, CardContent } from "@eins/ui";
import { formatEuro, formatNumber } from "@/lib/formatting";
import { SOURCE_LABELS, type RequestSource } from "@/lib/constants";
import type {
  PlatformMixRow,
  SpendRevenuePoint,
} from "@/server/queries/admin";
import { AreaChart } from "../_charts/AreaChart";
import { Donut } from "../_charts/Donut";

const PLATFORM_COLOR: Record<string, string> = {
  meta: "#1877F2",
  google: "#EA4335",
  csv: "#94a3b8",
};

interface Props {
  daily: SpendRevenuePoint[];
  mix: PlatformMixRow[];
  monthSpend: number;
  monthRevenue: number;
  monthLeads: number;
  monthCasesWon: number;
}

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

export function PerformanceSection({
  daily,
  mix,
  monthSpend,
  monthRevenue,
  monthLeads,
  monthCasesWon,
}: Props) {
  const chartData = daily.map((d) => ({
    date: d.date,
    spend: d.spendEur,
    revenue: d.revenueEur,
  }));

  const slices = mix.map((m) => ({
    name: SOURCE_LABELS[m.platform as RequestSource] ?? m.platform.toUpperCase(),
    value: m.spendEur,
    color: PLATFORM_COLOR[m.platform] ?? "#cbd5e1",
  }));

  const cpp = monthCasesWon > 0 ? monthSpend / monthCasesWon : null;
  const conversion =
    monthLeads > 0 ? (monthCasesWon / monthLeads) * 100 : null;

  return (
    <Card className={GLOW_CARD}>
      <CardContent className="space-y-6 pt-6">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
              Werbeleistung
            </span>
            <h2 className="mt-1 font-display text-2xl font-semibold">
              Ausgaben &amp; Umsatz · 90 Tage
            </h2>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <Legend dot="#94a3b8" label="Werbebudget" />
            <Legend dot="var(--accent)" label="Werbeumsatz" />
          </div>
        </header>
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
            <AreaChart
              data={chartData}
              series={[
                { key: "spend", name: "Werbebudget", color: "#94a3b8" },
                { key: "revenue", name: "Werbeumsatz", color: "var(--accent)" },
              ]}
              height={260}
              yKind="eur"
            />
          </div>
          <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
            <div className="mb-1 px-2 text-xs text-fg-secondary">
              Werbebudget je Plattform · 30 Tage
            </div>
            <Donut
              slices={slices}
              centerLabel={formatEuro(
                slices.reduce((acc, s) => acc + s.value, 0)
              )}
              centerSubLabel="Spend 30T"
              valueKind="eur"
              height={220}
            />
            <div className="mt-3 space-y-1 px-2 text-xs">
              {slices.length === 0 && (
                <span className="text-fg-secondary">
                  Noch keine Plattform-Daten.
                </span>
              )}
              {slices.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="flex-1 text-fg-primary">{s.name}</span>
                  <span className="font-mono tabular-nums text-fg-secondary">
                    {formatEuro(s.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <SubMetric
            label="Cost per Patient"
            value={cpp == null ? "–" : formatEuro(cpp)}
            sub={`${formatNumber(monthCasesWon)} gewonnen · Monat`}
          />
          <SubMetric
            label="Conversion (Lead → Patient)"
            value={conversion == null ? "–" : `${conversion.toFixed(1)} %`}
            sub={`${formatNumber(monthLeads)} qual. Leads`}
          />
          <SubMetric
            label="Net Margin"
            value={
              monthRevenue > 0
                ? `${((1 - monthSpend / Math.max(monthRevenue, 1)) * 100).toFixed(0)} %`
                : "–"
            }
            sub={`${formatEuro(monthRevenue - monthSpend)} Δ`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-secondary">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: dot }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function SubMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-primary/40 px-4 py-3">
      <div className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-fg-secondary">{sub}</div>}
    </div>
  );
}
