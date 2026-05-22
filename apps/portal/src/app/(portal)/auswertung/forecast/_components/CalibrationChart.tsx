"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEuro } from "@/lib/formatting";

export interface CalibrationRowDto {
  weekStart: string;
  predictedEur: number;
  actualEur: number;
}

/**
 * "Vorhersage vs. Realität": trailing 12 weeks. Bar = actual, line = the
 * p50 the forecast predicted a week before. This is the loop that proves
 * the 90%-Vorhersage out of Cluster D: if the line tracks the bars, the
 * inhaber learns to trust it; if not, the band widens automatically next
 * snapshot.
 *
 * Empty bars (predicted=0 and actual=0) are typical for new clinics during
 * their first 12 weeks of operation. The chart still renders so the
 * onboarding state is visible.
 */
export function CalibrationChart({ rows }: { rows: CalibrationRowDto[] }) {
  const data = rows.map((r) => ({
    label: formatWeekLabel(r.weekStart),
    predicted: r.predictedEur,
    actual: r.actualEur,
  }));

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fill: "rgb(var(--fg-secondary))", fontSize: 12 }}
            stroke="rgb(var(--border))"
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v) => formatEuro(v)}
            tick={{ fill: "rgb(var(--fg-secondary))", fontSize: 12 }}
            stroke="rgb(var(--border))"
            width={80}
          />
          <Tooltip
            content={<CalibrationTooltip />}
            cursor={{ fill: "rgb(var(--bg-secondary) / 0.4)" }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} iconType="square" />
          <Bar
            dataKey="actual"
            fill="rgb(var(--accent) / 0.6)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            name="Tatsächlich gebucht"
          />
          <Line
            type="monotone"
            dataKey="predicted"
            stroke="rgb(var(--fg-primary))"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
            name="Vorhergesagt (p50)"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CalibrationTooltipPayload {
  label: string;
  predicted: number;
  actual: number;
}

function CalibrationTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CalibrationTooltipPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const delta = row.actual - row.predicted;
  const deltaPct =
    row.predicted > 0 ? Math.round((delta / row.predicted) * 100) : null;
  return (
    <div className="rounded-md border border-border bg-bg-primary p-3 text-xs shadow-md">
      <div className="mb-1.5 font-medium text-fg-primary">Woche ab {row.label}</div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center gap-2">
          <span className="text-fg-secondary">Vorhergesagt:</span>
          <span className="ml-auto font-medium">{formatEuro(row.predicted)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-fg-secondary">Tatsächlich:</span>
          <span className="ml-auto font-medium">{formatEuro(row.actual)}</span>
        </div>
        {deltaPct != null && (
          <div className="pt-1 text-fg-tertiary">
            Abweichung: {deltaPct > 0 ? "+" : ""}
            {deltaPct} %
          </div>
        )}
      </div>
    </div>
  );
}

function formatWeekLabel(weekStart: string): string {
  const [_y, m, d] = weekStart.split("-");
  return `${d}.${m}.`;
}
