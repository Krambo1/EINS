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

export interface LineSeries {
  key: string;
  name: string;
  color: string;
}

export interface LinePoint {
  date: string;
  [k: string]: number | string;
}

const numFormatter = new Intl.NumberFormat("de-DE");
const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

export function LineChart({
  data,
  series,
  height = 220,
}: {
  data: LinePoint[];
  series: LineSeries[];
  height?: number;
}) {
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
          tickFormatter={(v: number) => numFormatter.format(v)}
          axisLine={false}
          tickLine={false}
          width={42}
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
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
