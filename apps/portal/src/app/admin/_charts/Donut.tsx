"use client";

import * as React from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

interface Props {
  slices: DonutSlice[];
  /** Big text rendered in the centre. */
  centerLabel?: React.ReactNode;
  /** Small text under centerLabel. */
  centerSubLabel?: React.ReactNode;
  height?: number;
  /** "EUR" or "Anzahl" — used in the tooltip value formatter. */
  valueKind?: "eur" | "number";
}

const numFormatter = new Intl.NumberFormat("de-DE");
const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function Donut({
  slices,
  centerLabel,
  centerSubLabel,
  height = 220,
  valueKind = "number",
}: Props) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const fmt =
    valueKind === "eur"
      ? (v: number) => eurFormatter.format(v)
      : (v: number) => numFormatter.format(v);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices.length ? slices : [{ name: "Keine Daten", value: 1, color: "var(--bg-tertiary)" }]}
            innerRadius="62%"
            outerRadius="92%"
            dataKey="value"
            stroke="var(--bg-primary)"
            strokeWidth={2}
            paddingAngle={slices.length > 1 ? 1 : 0}
          >
            {(slices.length ? slices : [{ color: "var(--bg-tertiary)" }]).map(
              (s, i) => (
                <Cell key={i} fill={s.color} />
              )
            )}
          </Pie>
          {slices.length > 0 && (
            <Tooltip
              contentStyle={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number, name: string) => [
                `${fmt(v)} (${total > 0 ? ((v / total) * 100).toFixed(0) : 0}%)`,
                name,
              ]}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerSubLabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerLabel && (
            <div className="font-display text-2xl font-semibold tabular-nums text-fg-primary">
              {centerLabel}
            </div>
          )}
          {centerSubLabel && (
            <div className="text-[11px] uppercase tracking-wider text-fg-secondary">
              {centerSubLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
