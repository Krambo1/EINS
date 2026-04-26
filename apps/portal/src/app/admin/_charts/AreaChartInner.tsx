"use client";

import * as React from "react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface AreaChartSeries {
  key: string;
  name: string;
  color: string;
}

export interface AreaChartPoint {
  date: string;
  [k: string]: number | string;
}

interface Props {
  data: AreaChartPoint[];
  series: AreaChartSeries[];
  height?: number;
  /** "EUR" or "Anzahl" — used in the y-axis tick formatter. */
  yKind?: "eur" | "number";
  /** Show grid lines. */
  showGrid?: boolean;
}

const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const numFormatter = new Intl.NumberFormat("de-DE");
const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

export function AreaChartInner({
  data,
  series,
  height = 240,
  yKind = "eur",
  showGrid = true,
}: Props) {
  const formatY = (v: number) =>
    yKind === "eur" ? eurFormatter.format(v) : numFormatter.format(v);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart
        data={data}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`grad-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        {showGrid && (
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        )}
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--fg-secondary)", fontSize: 11 }}
          tickFormatter={(v: string) =>
            dateFormatter.format(new Date(v))
          }
          axisLine={false}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis
          tick={{ fill: "var(--fg-secondary)", fontSize: 11 }}
          tickFormatter={formatY}
          axisLine={false}
          tickLine={false}
          width={62}
        />
        <Tooltip
          contentStyle={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(v) =>
            new Intl.DateTimeFormat("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            }).format(new Date(v as string))
          }
          formatter={(v: number, name: string) => [formatY(v), name]}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
