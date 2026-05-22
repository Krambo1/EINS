"use client";

import {
  Area,
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

export interface WeeklyBucketDto {
  weekStart: string;
  booked: { p10: number; p50: number; p90: number };
  paid: { p10: number; p50: number; p90: number };
}

/**
 * Dual-line cashflow chart with confidence bands.
 *
 * Booked = revenue at the moment a deal is won (status='gewonnen').
 * Paid   = revenue at the moment the InvoicePaid event lands (DSO-shifted).
 *
 * The shaded bands are p10..p90 of the bootstrap (500 resamples). Solid
 * lines are p50. Honoring the 90%-Vorhersage from Cluster D means showing
 * the uncertainty, not pretending the p50 is fact.
 */
export function ForecastChart({ buckets }: { buckets: WeeklyBucketDto[] }) {
  const data = buckets.map((b) => ({
    weekStart: b.weekStart,
    label: formatWeekLabel(b.weekStart),
    bookedP50: b.booked.p50,
    bookedRange: [b.booked.p10, b.booked.p90] as [number, number],
    paidP50: b.paid.p50,
    paidRange: [b.paid.p10, b.paid.p90] as [number, number],
  }));

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 20, right: 16, bottom: 0, left: 0 }}>
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
            content={<ChartTooltip />}
            cursor={{ stroke: "rgb(var(--border))", strokeWidth: 1 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 13 }}
            iconType="line"
            payload={[
              {
                value: "Gebuchter Umsatz (p50)",
                type: "line",
                color: "rgb(var(--accent))",
                id: "booked",
              },
              {
                value: "Gezahlter Umsatz (p50)",
                type: "line",
                color: "rgb(var(--tone-good))",
                id: "paid",
              },
              {
                value: "Konfidenzband (p10 bis p90)",
                type: "rect",
                color: "rgb(var(--accent) / 0.15)",
                id: "band",
              },
            ]}
          />
          {/* Booked confidence band (lower opacity so the line is visible). */}
          <Area
            type="monotone"
            dataKey="bookedRange"
            stroke="none"
            fill="rgb(var(--accent))"
            fillOpacity={0.12}
            isAnimationActive={false}
            legendType="none"
            activeDot={false}
          />
          {/* Paid confidence band: lighter green tint. */}
          <Area
            type="monotone"
            dataKey="paidRange"
            stroke="none"
            fill="rgb(var(--tone-good))"
            fillOpacity={0.08}
            isAnimationActive={false}
            legendType="none"
            activeDot={false}
          />
          <Line
            type="monotone"
            dataKey="bookedP50"
            stroke="rgb(var(--accent))"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
            name="booked"
          />
          <Line
            type="monotone"
            dataKey="paidP50"
            stroke="rgb(var(--tone-good))"
            strokeWidth={2.5}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
            name="paid"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipPayload {
  weekStart: string;
  label: string;
  bookedP50: number;
  bookedRange: [number, number];
  paidP50: number;
  paidRange: [number, number];
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TooltipPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-bg-primary p-3 text-xs shadow-md">
      <div className="mb-1.5 font-medium text-fg-primary">
        Woche ab {formatWeekLabel(row.weekStart)}
      </div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
          <span className="text-fg-secondary">Gebucht:</span>
          <span className="ml-auto font-medium text-fg-primary">
            {formatEuro(row.bookedP50)}
          </span>
        </div>
        <div className="ml-4 text-fg-tertiary">
          Bandbreite {formatEuro(row.bookedRange[0])} bis {formatEuro(row.bookedRange[1])}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-tone-good" />
          <span className="text-fg-secondary">Gezahlt:</span>
          <span className="ml-auto font-medium text-fg-primary">
            {formatEuro(row.paidP50)}
          </span>
        </div>
        <div className="ml-4 text-fg-tertiary">
          Bandbreite {formatEuro(row.paidRange[0])} bis {formatEuro(row.paidRange[1])}
        </div>
      </div>
    </div>
  );
}

function formatWeekLabel(weekStart: string): string {
  const [_y, m, d] = weekStart.split("-");
  return `${d}.${m}.`;
}
