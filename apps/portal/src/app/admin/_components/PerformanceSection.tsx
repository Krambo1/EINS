import { Card, CardContent, CardHeader, CardTitle, TrendChart } from "@eins/ui";
import { formatEuro } from "@/lib/formatting";
import { SOURCE_LABELS, type RequestSource } from "@/lib/constants";
import { SegmentedShareBar } from "@/app/_components/SegmentedShareBar";
import { SHARE_TONE_VAR, type ShareTone } from "@/lib/share-tone";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { ADMIN_RANGE_KEYS, type DashboardRange } from "@/lib/dashboard-range";
import type { PlatformMixRow, SpendRevenuePoint } from "@/server/queries/admin";

const PLATFORM_TONE: Record<string, ShareTone> = {
  meta: "accent",
  google: "good",
  csv: "neutral",
};

interface Props {
  daily: SpendRevenuePoint[];
  mix: PlatformMixRow[];
  range: DashboardRange;
}

/**
 * Werbeleistung — spend vs. revenue trend over the card's own time window, with
 * the platform-budget split rendered as the shared segmented share bar (the
 * same visual the clinic uses). Both sit directly on the card surface: no inner
 * boxes, no derived sub-metric tiles.
 */
export function PerformanceSection({ daily, mix, range }: Props) {
  const spendPoints = daily.map((d) => ({ date: d.date, value: d.spendEur }));
  const revenuePoints = daily.map((d) => ({ date: d.date, value: d.revenueEur }));

  const segments = mix.map((m) => ({
    key: m.platform,
    label: SOURCE_LABELS[m.platform as RequestSource] ?? m.platform.toUpperCase(),
    value: m.spendEur,
    tone: PLATFORM_TONE[m.platform] ?? "neutral",
  }));
  const mixTotal = segments.reduce((acc, s) => acc + s.value, 0);

  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            Werbeleistung
          </CardTitle>
          <p className="text-sm text-fg-secondary">
            Werbebudget und Werbeumsatz im Zeitraum.
          </p>
        </div>
        <TimeRangeToggle
          value={range}
          paramKey={ADMIN_RANGE_KEYS.perf}
          ariaLabel="Zeitraum für Werbeleistung"
        />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-4 text-xs">
          <Legend dot="var(--fg-secondary)" label="Werbebudget" />
          <Legend dot="var(--accent)" label="Werbeumsatz" />
        </div>
        <TrendChart
          data={spendPoints}
          series={[
            {
              points: spendPoints,
              tone: "neutral",
              label: "Werbebudget",
              filled: true,
            },
            {
              points: revenuePoints,
              tone: "accent",
              label: "Werbeumsatz",
              filled: true,
            },
          ]}
          height={240}
          showAxes
          showGrid
          valueFormat="euro"
          ariaLabel="Werbebudget und Werbeumsatz im Zeitraum"
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-fg-secondary">
            <span>Werbebudget je Plattform</span>
            <span className="tabular-nums">{formatEuro(mixTotal)}</span>
          </div>
          <SegmentedShareBar
            segments={segments}
            ariaLabel={`Werbebudget je Plattform: ${formatEuro(mixTotal)}`}
            valueFormat="euro"
            valueLabel="Budget"
          />
          {segments.length === 0 ? (
            <p className="text-xs text-fg-secondary">
              Noch keine Plattform-Daten.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {segments.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: SHARE_TONE_VAR[s.tone] }}
                    aria-hidden
                  />
                  <span className="text-fg-primary">{s.label}</span>
                  <span className="tabular-nums text-fg-secondary">
                    {formatEuro(s.value)}
                  </span>
                </span>
              ))}
            </div>
          )}
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
