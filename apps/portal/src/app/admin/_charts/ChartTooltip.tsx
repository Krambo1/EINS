"use client";

import * as React from "react";

const fmtDateLong = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function parseDateLoose(raw: string): Date | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

function formatDateHeader(raw: unknown): string {
  if (typeof raw !== "string") return String(raw ?? "");
  const d = parseDateLoose(raw);
  return d ? fmtDateLong.format(d) : raw;
}

export interface ChartTooltipRow {
  name: string;
  value: string;
  color: string;
}

/**
 * Tooltip card matching the clinic-side TrendChart visual: a date header,
 * then one row per series with a color swatch, name, and big formatted value.
 * Designed to be passed as `content` to recharts <Tooltip />.
 */
export function ChartTooltipCard({
  header,
  rows,
}: {
  header: React.ReactNode;
  rows: ChartTooltipRow[];
}) {
  return (
    <div className="pointer-events-none relative z-50 whitespace-nowrap rounded-md border border-border bg-bg-secondary px-3 py-2 shadow-xl">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {header}
      </div>
      <div className="mt-1 space-y-0.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
            {row.name ? (
              <span className="text-xs text-fg-secondary">{row.name}:</span>
            ) : null}
            <span className="font-display text-sm font-semibold tabular-nums text-fg-primary">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Recharts custom Tooltip renderer. Pass via `<Tooltip content={...} />`.
 *
 * `formatValue` is per-series so callers can format euros, percentages,
 * or raw counts differently — matches the per-series formatting on the
 * clinic-side TrendChart.
 */
export function makeRechartsTooltip(
  formatValue: (value: number, name: string) => string,
  options?: { headerFormatter?: (label: unknown) => React.ReactNode }
) {
  const headerFormatter = options?.headerFormatter ?? formatDateHeader;
  function RechartsTooltip(props: {
    active?: boolean;
    label?: unknown;
    payload?: ReadonlyArray<{
      name?: string;
      value?: number | string;
      color?: string;
      dataKey?: string;
    }>;
  }) {
    if (!props.active || !props.payload || props.payload.length === 0)
      return null;

    const rows: ChartTooltipRow[] = props.payload.map((p) => {
      const value = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
      const name = p.name ?? p.dataKey ?? "";
      return {
        name,
        value: formatValue(value, name),
        color: p.color ?? "var(--accent)",
      };
    });

    return <ChartTooltipCard header={headerFormatter(props.label)} rows={rows} />;
  }
  return RechartsTooltip;
}
