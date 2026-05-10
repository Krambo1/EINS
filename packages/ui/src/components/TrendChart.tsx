"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export type TrendChartTone = "neutral" | "good" | "warn" | "bad" | "accent";

const stroke: Record<TrendChartTone, string> = {
  neutral: "var(--fg-secondary)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
  accent: "var(--accent)",
};

export interface TrendChartPoint {
  /** ISO date string (YYYY-MM-DD) or anything Date.parse-able. */
  date: string;
  value: number;
}

/**
 * Serializable formatter spec. Use this from server components (function
 * props can't cross the server→client boundary). Client callers may keep
 * passing `formatValue` directly.
 */
export type TrendChartValueFormat =
  | "number"
  | "euro"
  | "rating"
  | "roas"
  | "minutes"
  | "percent1";

export interface TrendChartProps {
  data: TrendChartPoint[];
  tone?: TrendChartTone;
  height?: number;
  className?: string;
  /** Render a gradient-filled area under the line. Default true. */
  filled?: boolean;
  /** Render axis labels (date x-axis ticks, value y-axis ticks). Default false. */
  showAxes?: boolean;
  /**
   * Format value shown in tooltip + axis labels. Defaults to de-DE locale.
   * Server components must use `valueFormat` instead — functions can't be
   * passed across the server→client boundary.
   */
  formatValue?: (n: number) => string;
  /** Serializable formatter spec for server-component callers. Overrides `formatValue` when set. */
  valueFormat?: TrendChartValueFormat;
  /** Optional label that prefixes the value in the tooltip ("Anfragen", "Umsatz"). */
  label?: string;
  /** Locale for date formatting. Default 'de-DE'. */
  locale?: string;
  /** Accessible description for screen readers. */
  ariaLabel?: string;
}

/**
 * Monotone cubic Hermite (Fritsch–Carlson) — smooth curve that never overshoots
 * the input points. Same algorithm as `Sparkline` so they match visually.
 */
function monotoneCubicPath(
  pts: { x: number; y: number }[]
): { move: string; segments: string } {
  const n = pts.length;
  if (n === 0) return { move: "", segments: "" };
  const move = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  if (n === 1) return { move, segments: "" };

  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const m: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0;
    } else {
      t[i] = (m[i - 1] + m[i]) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const k = 3 / h;
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }

  let segments = "";
  for (let i = 0; i < n - 1; i++) {
    const cp1x = pts[i].x + dx[i] / 3;
    const cp1y = pts[i].y + (t[i] * dx[i]) / 3;
    const cp2x = pts[i + 1].x - dx[i] / 3;
    const cp2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3;
    segments += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return { move, segments };
}

const defaultFormatValue = (n: number): string =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n);

const numberDeFormat = new Intl.NumberFormat("de-DE");
const euroDeFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function resolveValueFormat(spec: TrendChartValueFormat): (n: number) => string {
  switch (spec) {
    case "number":
      return (n) => (Number.isFinite(n) ? numberDeFormat.format(n) : "–");
    case "euro":
      return (n) => (Number.isFinite(n) ? euroDeFormat.format(n) : "–");
    case "rating":
      return (n) =>
        Number.isFinite(n) ? n.toFixed(2).replace(".", ",") + " ★" : "–";
    case "roas":
      return (n) =>
        Number.isFinite(n) ? n.toFixed(2).replace(".", ",") + "×" : "–";
    case "minutes":
      return (n) => {
        if (!Number.isFinite(n)) return "–";
        if (n < 60) return `${Math.round(n)} Min`;
        if (n < 60 * 24)
          return `${(n / 60).toFixed(1).replace(".", ",")} Std`;
        return `${(n / 60 / 24).toFixed(1).replace(".", ",")} Tage`;
      };
    case "percent1":
      return (n) =>
        Number.isFinite(n) ? n.toFixed(1).replace(".", ",") + " %" : "–";
  }
}

function pickTickIndices(len: number, max = 5): number[] {
  if (len <= 1) return [0];
  if (len <= max) return Array.from({ length: len }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(Math.round((i * (len - 1)) / (max - 1)));
  }
  return out;
}

/**
 * Interactive line/area chart with stock-chart-style hover behavior.
 *
 * - Renders the same monotone-cubic curve + gradient fill as `Sparkline` so
 *   server-rendered HTML matches the post-hydration visual exactly.
 * - On pointer move: vertical crosshair, focus dot, and a tooltip with the
 *   date and value. Tooltip clamps to the container edges so it never clips.
 * - Optional date x-axis ticks + min/max y-axis labels.
 * - Zero external dependencies. Bundle cost: ~3 KB minified.
 *
 * Performance notes:
 * - Path geometry is memoized on `data`/`height`; hover state changes only
 *   re-render the lightweight overlay (crosshair + dot + tooltip).
 * - Pointer handler reads `getBoundingClientRect` on the wrapping div and
 *   maps mouse-x into a data index — no per-frame layout work.
 */
export function TrendChart({
  data,
  tone = "accent",
  height = 64,
  className,
  filled = true,
  showAxes = false,
  formatValue,
  valueFormat,
  label,
  locale = "de-DE",
  ariaLabel,
}: TrendChartProps) {
  const reactId = React.useId();
  const gradId = `trend-grad-${reactId.replace(/:/g, "")}`;
  const [activeIdx, setActiveIdx] = React.useState<number | null>(null);

  const fmtValue = React.useMemo(
    () =>
      valueFormat
        ? resolveValueFormat(valueFormat)
        : formatValue ?? defaultFormatValue,
    [valueFormat, formatValue]
  );
  const fmtDateShort = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
      }),
    [locale]
  );
  const fmtDateLong = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    [locale]
  );

  const geom = React.useMemo(() => {
    if (!data || data.length === 0) {
      return null;
    }
    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const width = Math.max(data.length * 4, 80);
    const stepX = data.length > 1 ? width / (data.length - 1) : width;
    const points = data.map((d, i) => ({
      x: i * stepX,
      y: height - ((d.value - min) / range) * height,
    }));
    const { move, segments } = monotoneCubicPath(points);
    const linePath = move + segments;
    const first = points[0];
    const last = points[points.length - 1];
    const areaPath = `M0,${height.toFixed(2)} L${first.x.toFixed(2)},${first.y.toFixed(2)}${segments} L${last.x.toFixed(2)},${height.toFixed(2)} Z`;
    return { points, linePath, areaPath, width, min, max };
  }, [data, height]);

  if (!geom) {
    return (
      <div
        className={cn("h-9 w-full rounded bg-bg-secondary/40", className)}
        style={{ height }}
        aria-hidden
      />
    );
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || data.length === 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (data.length - 1));
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    setActiveIdx(clamped);
  };

  const handlePointerLeave = () => setActiveIdx(null);

  const denom = Math.max(1, data.length - 1);
  const activePct =
    activeIdx !== null ? (activeIdx / denom) * 100 : 0;
  const activePoint =
    activeIdx !== null && geom ? geom.points[activeIdx] : null;
  const activeData = activeIdx !== null ? data[activeIdx] : null;
  const activeYPct =
    activePoint != null ? (activePoint.y / Math.max(1, height)) * 100 : 0;

  const xTickIdx = showAxes ? pickTickIndices(data.length, 5) : [];

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className="relative w-full select-none touch-none"
        style={{ height }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
        role="img"
        aria-label={ariaLabel ?? label}
      >
        <svg
          viewBox={`0 0 ${geom.width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible pointer-events-none"
          aria-hidden
        >
          {filled && (
            <>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    style={{ stopColor: stroke[tone], stopOpacity: 0.35 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: stroke[tone], stopOpacity: 0.04 }}
                  />
                </linearGradient>
              </defs>
              <path d={geom.areaPath} fill={`url(#${gradId})`} stroke="none" />
            </>
          )}
          <path
            d={geom.linePath}
            fill="none"
            stroke={stroke[tone]}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Y-axis tick labels (min/max), overlay so they never affect path
            geometry. Only when axes are enabled. */}
        {showAxes && (
          <>
            <span className="pointer-events-none absolute right-0 top-0 -translate-y-1/2 rounded bg-bg-primary/80 px-1 font-mono text-[10px] tabular-nums text-fg-tertiary">
              {fmtValue(geom.max)}
            </span>
            <span className="pointer-events-none absolute right-0 bottom-0 translate-y-1/2 rounded bg-bg-primary/80 px-1 font-mono text-[10px] tabular-nums text-fg-tertiary">
              {fmtValue(geom.min)}
            </span>
          </>
        )}

        {/* Crosshair line */}
        {activeIdx !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-fg-tertiary/45"
            style={{ left: `${activePct}%` }}
          />
        )}

        {/* Focus dot */}
        {activeIdx !== null && activePoint && (
          <span
            aria-hidden
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[1.5px] ring-bg-primary"
            style={{
              left: `${activePct}%`,
              top: `${activeYPct}%`,
              backgroundColor: stroke[tone],
            }}
          />
        )}

        {/* Tooltip — clamped so it doesn't overflow the chart edges */}
        {activeIdx !== null && activeData && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-border bg-bg-secondary px-3 py-2 shadow-lg"
            style={{
              left: `${activePct}%`,
              top: 0,
              transform: `translate(${activePct < 15 ? "0" : activePct > 85 ? "-100%" : "-50%"}, calc(-100% - 8px))`,
            }}
          >
            <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
              {formatTooltipDate(activeData.date, fmtDateLong)}
            </div>
            <div className="mt-1 font-display text-base font-semibold tabular-nums text-fg-primary">
              {label ? <span className="font-normal text-fg-secondary">{label}: </span> : null}
              {fmtValue(activeData.value)}
            </div>
          </div>
        )}
      </div>

      {/* X-axis date ticks */}
      {showAxes && data.length > 1 && (
        <div
          aria-hidden
          className="relative h-3 text-[10px] font-mono tabular-nums text-fg-tertiary"
        >
          {xTickIdx.map((i) => {
            const pct = (i / denom) * 100;
            return (
              <span
                key={i}
                className="absolute top-0"
                style={{
                  left: `${pct}%`,
                  transform: `translateX(${pct < 5 ? "0" : pct > 95 ? "-100%" : "-50%"})`,
                }}
              >
                {formatTickDate(data[i].date, fmtDateShort)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTooltipDate(raw: string, fmt: Intl.DateTimeFormat): string {
  const d = parseDateLoose(raw);
  if (!d) return raw;
  return fmt.format(d);
}

function formatTickDate(raw: string, fmt: Intl.DateTimeFormat): string {
  const d = parseDateLoose(raw);
  if (!d) return raw;
  return fmt.format(d);
}

function parseDateLoose(raw: string): Date | null {
  if (!raw) return null;
  // Treat `YYYY-MM-DD` as UTC midnight to avoid TZ-shift surprises (the
  // server emits dates in this exact format from `Date.toISOString().slice(0,10)`).
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}
