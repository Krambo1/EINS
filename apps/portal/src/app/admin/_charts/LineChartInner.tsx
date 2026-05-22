"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEuro, formatNumber } from "@/lib/formatting";
import { makeRechartsTooltip } from "./ChartTooltip";

export interface LineSeries {
  key: string;
  name: string;
  color: string;
  /** "EUR" or "Anzahl" — used in the tooltip + axis value formatter. */
  valueKind?: "eur" | "number";
}

export interface LinePoint {
  date: string;
  [k: string]: number | string;
}

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

export function LineChartInner({
  data,
  series,
  height = 220,
}: {
  data: LinePoint[];
  series: LineSeries[];
  height?: number;
}) {
  const valueKindByName = React.useMemo(() => {
    const m = new Map<string, "eur" | "number">();
    for (const s of series) m.set(s.name, s.valueKind ?? "number");
    return m;
  }, [series]);

  const formatValue = React.useCallback(
    (value: number, name: string) => {
      const kind = valueKindByName.get(name) ?? "number";
      if (!Number.isFinite(value)) return "–";
      return kind === "eur" ? formatEuro(value) : formatNumber(value);
    },
    [valueKindByName]
  );

  const TooltipContent = React.useMemo(
    () => makeRechartsTooltip(formatValue),
    [formatValue]
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--fg-secondary)", fontSize: 11 }}
          tickFormatter={(v: string) => dateFormatter.format(new Date(v))}
          axisLine={false}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis
          tick={{ fill: "var(--fg-secondary)", fontSize: 11 }}
          tickFormatter={(v: number) => formatNumber(v)}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        <Tooltip
          content={<TooltipContent />}
          cursor={{ stroke: "var(--fg-tertiary)", strokeOpacity: 0.45, strokeWidth: 1 }}
          wrapperStyle={{ outline: "none", zIndex: 50 }}
          isAnimationActive={false}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              stroke: "var(--bg-primary)",
              strokeWidth: 1.5,
              fill: s.color,
            }}
            isAnimationActive={false}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
