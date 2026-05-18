"use client";

import * as React from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";
import { ChartTooltipCard } from "./ChartTooltip";

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

interface ActiveShapeProps {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  fill: string;
}

function renderActiveShape(props: unknown) {
  const p = props as ActiveShapeProps;
  return (
    <g>
      <Sector
        cx={p.cx}
        cy={p.cy}
        innerRadius={p.innerRadius}
        outerRadius={p.outerRadius + 4}
        startAngle={p.startAngle}
        endAngle={p.endAngle}
        fill={p.fill}
        stroke="var(--bg-primary)"
        strokeWidth={2}
      />
    </g>
  );
}

export function DonutInner({
  slices,
  centerLabel,
  centerSubLabel,
  height = 220,
  valueKind = "number",
}: Props) {
  const [activeIndex, setActiveIndex] = React.useState<number | undefined>(
    undefined
  );

  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const fmt = React.useCallback(
    (v: number) =>
      !Number.isFinite(v)
        ? "–"
        : valueKind === "eur"
          ? eurFormatter.format(v)
          : numFormatter.format(v),
    [valueKind]
  );

  function DonutTooltip(props: {
    active?: boolean;
    payload?: ReadonlyArray<{
      name?: string;
      value?: number | string;
      payload?: { color?: string; name?: string };
    }>;
  }) {
    if (!props.active || !props.payload || props.payload.length === 0)
      return null;
    const entry = props.payload[0];
    const value =
      typeof entry.value === "number"
        ? entry.value
        : Number(entry.value ?? 0);
    const name = entry.name ?? entry.payload?.name ?? "";
    const color = entry.payload?.color ?? "var(--accent)";
    const pct = total > 0 ? (value / total) * 100 : 0;
    const valueStr = `${fmt(value)} · ${pct.toFixed(0)} %`;
    return (
      <ChartTooltipCard
        header={name}
        rows={[{ name: "", value: valueStr, color }]}
      />
    );
  }

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={
              slices.length
                ? slices
                : [{ name: "Keine Daten", value: 1, color: "var(--bg-tertiary)" }]
            }
            innerRadius="62%"
            outerRadius="92%"
            dataKey="value"
            stroke="var(--bg-primary)"
            strokeWidth={2}
            paddingAngle={slices.length > 1 ? 1 : 0}
            activeIndex={slices.length ? activeIndex : undefined}
            activeShape={renderActiveShape}
            onMouseEnter={(_, i) => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(undefined)}
            isAnimationActive={false}
          >
            {(slices.length ? slices : [{ color: "var(--bg-tertiary)" }]).map(
              (s, i) => (
                <Cell key={i} fill={s.color} />
              )
            )}
          </Pie>
          {slices.length > 0 && (
            <Tooltip
              content={<DonutTooltip />}
              wrapperStyle={{ outline: "none", zIndex: 50 }}
              isAnimationActive={false}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerSubLabel) && (
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center transition-opacity duration-150"
          style={{ opacity: activeIndex != null ? 0 : 1 }}
          aria-hidden={activeIndex != null}
        >
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
