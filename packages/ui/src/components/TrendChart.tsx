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
  /**
   * Optional comparison series rendered as a low-contrast grey line behind
   * `data`. Plotted at the same x positions as `data` (index-aligned, so
   * point N of comparison sits at point N of data), but contributes to the
   * shared y-axis so the two curves are visually comparable. Typically the
   * previous equivalent period (last week vs this week, last month vs this
   * month). The hover tooltip surfaces the comparison value and its own
   * date alongside the primary value.
   */
  comparisonData?: TrendChartPoint[];
  /** Short label for the comparison series in the tooltip (e.g. "Vorperiode"). Default "Vorperiode". */
  comparisonLabel?: string;
  tone?: TrendChartTone;
  height?: number;
  className?: string;
  /** Render a gradient-filled area under the line. Default true. */
  filled?: boolean;
  /** Render axis labels (date x-axis ticks, value y-axis ticks). Default false. */
  showAxes?: boolean;
  /**
   * When `showAxes` is on, set to `false` to hide just the y-axis tick labels
   * while keeping the x-axis date ticks. Useful on dashboard tiles where the
   * big headline value already conveys the magnitude. Default `true`.
   */
  showYAxis?: boolean;
  /**
   * Render subtle gridlines aligned with the x-tick positions and at the
   * top, middle, and bottom y. Default false. Implies `showAxes` styling
   * for label placement but doesn't force `showAxes`.
   */
  showGrid?: boolean;
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
 * Pick a "nice" axis max ≥ the data max, rounded to 1/2/5 × 10^k so the
 * y-axis ticks land on readable round numbers (3, 5, 10, 20, 50, 100, …)
 * instead of the raw data peak.
 */
function niceAxisMax(rawMax: number): number {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return 1;
  const exp = Math.floor(Math.log10(rawMax));
  const pow = Math.pow(10, exp);
  const norm = rawMax / pow;
  let niceNorm: number;
  if (norm <= 1) niceNorm = 1;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 2.5) niceNorm = 2.5;
  else if (norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  return niceNorm * pow;
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
  comparisonData,
  comparisonLabel = "Vorperiode",
  tone = "accent",
  height = 64,
  className,
  filled = true,
  showAxes = false,
  showYAxis = true,
  showGrid = false,
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
    // Include comparison values in the y-axis fit so the two curves render
    // on the same scale — otherwise a much-larger prior period would be
    // visually flattened against the bottom (or worse, clip above the top).
    const cmpValues =
      comparisonData && comparisonData.length > 0
        ? comparisonData.map((d) => d.value)
        : [];
    const rawMax = Math.max(...values, ...cmpValues, 0);
    const min = 0;
    const max = niceAxisMax(rawMax);
    const range = max - min || 1;
    const width = Math.max(data.length * 4, 80);
    // Single-point data — pad to two points at the same y so the line spans
    // the full plot area instead of collapsing to a dot at x=0.
    const isSinglePoint = data.length === 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;
    const toY = (v: number) => height - ((v - min) / range) * height;
    const points = isSinglePoint
      ? (() => {
          const y = toY(data[0].value);
          return [
            { x: 0, y },
            { x: width, y },
          ];
        })()
      : data.map((d, i) => ({ x: i * stepX, y: toY(d.value) }));
    const { move, segments } = monotoneCubicPath(points);
    const linePath = move + segments;
    const first = points[0];
    const last = points[points.length - 1];
    const areaPath = `M0,${height.toFixed(2)} L${first.x.toFixed(2)},${first.y.toFixed(2)}${segments} L${last.x.toFixed(2)},${height.toFixed(2)} Z`;

    // Comparison line: plotted at the current series' x positions, indexed
    // pairwise (point N of comparison sits at point N of data). If the two
    // lengths differ we truncate to the shorter — common when the prior
    // window is a partial period or includes/excludes a leap day.
    let comparisonPoints: { x: number; y: number }[] | null = null;
    let comparisonPath: string | null = null;
    if (comparisonData && comparisonData.length > 0) {
      const len = Math.min(data.length, comparisonData.length);
      if (len === 1) {
        const y = toY(comparisonData[0].value);
        comparisonPoints = [
          { x: 0, y },
          { x: width, y },
        ];
      } else if (len > 1) {
        const cmpStepX = data.length > 1 ? width / (data.length - 1) : width;
        comparisonPoints = comparisonData
          .slice(0, len)
          .map((d, i) => ({ x: i * cmpStepX, y: toY(d.value) }));
      }
      if (comparisonPoints && comparisonPoints.length > 0) {
        const { move: cmove, segments: cseg } = monotoneCubicPath(comparisonPoints);
        comparisonPath = cmove + cseg;
      }
    }

    return {
      points,
      linePath,
      areaPath,
      width,
      min,
      max,
      comparisonPath,
      comparisonPoints,
    };
  }, [data, comparisonData, height]);

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
    // Pointer handler lives on the plot-area div (the flex-1 child), so the
    // rect IS the plot area — no gutter offset to subtract.
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
  const activeComparisonData =
    activeIdx !== null && comparisonData && activeIdx < comparisonData.length
      ? comparisonData[activeIdx]
      : null;
  const activeComparisonPoint =
    activeIdx !== null &&
    geom?.comparisonPoints &&
    activeIdx < geom.comparisonPoints.length
      ? geom.comparisonPoints[activeIdx]
      : null;
  const activeComparisonYPct =
    activeComparisonPoint != null
      ? (activeComparisonPoint.y / Math.max(1, height)) * 100
      : 0;

  const xTickIdx = showAxes || showGrid ? pickTickIndices(data.length, 5) : [];
  // Y-axis tick fractions from bottom (0) to top (max). 5 ticks → quarters.
  const yTickFractions = [0, 0.25, 0.5, 0.75, 1];
  // Reserve room on the left for y-axis labels when axes are shown.
  const yAxisLabelWidth = showAxes && showYAxis ? 28 : 0;

  return (
    <div className={cn("flex w-full max-w-full flex-col gap-1", className)}>
      <div className="flex w-full" style={{ height }}>
        {/* Y-axis gutter — fixed-width sibling holding the tick labels.
            Dedupe consecutive duplicate labels (e.g. "0 €" / "0 €" when the
            data range rounds to the same formatted value) so the gutter
            doesn't show repeating ticks. */}
        {showAxes && showYAxis && (() => {
          const seen = new Set<string>();
          const ticks = yTickFractions
            .map((t) => ({ t, v: geom.min + (geom.max - geom.min) * t }))
            .map(({ t, v }) => ({ t, v, text: fmtValue(v) }))
            .filter(({ text }) => {
              if (seen.has(text)) return false;
              seen.add(text);
              return true;
            });
          return (
            <div
              aria-hidden
              className="relative shrink-0 font-mono text-[10px] tabular-nums text-fg-tertiary"
              style={{ width: yAxisLabelWidth, height }}
            >
              {ticks.map(({ t, text }) => (
                <span
                  key={`yl-${t}`}
                  className="absolute right-1 -translate-y-1/2 whitespace-nowrap"
                  style={{ top: `${(1 - t) * 100}%` }}
                >
                  {text}
                </span>
              ))}
            </div>
          );
        })()}
        {/* Plot area — flex-1 child, owns the SVG + pointer handler. */}
        <div
          className="relative min-w-0 flex-1 select-none touch-none"
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
            className="block h-full w-full pointer-events-none"
            aria-hidden
          >
            {showGrid && (
              <g stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6}>
                {yTickFractions.map((t) => (
                  <line
                    key={`h${t}`}
                    x1={0}
                    x2={geom.width}
                    y1={(1 - t) * height}
                    y2={(1 - t) * height}
                  />
                ))}
              </g>
            )}
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
            {/* Comparison line — drawn after the fill but before the main
                line so it sits behind without being masked by the gradient. */}
            {geom.comparisonPath && (
              <path
                d={geom.comparisonPath}
                fill="none"
                stroke="var(--fg-tertiary)"
                strokeOpacity={0.55}
                strokeWidth={1.25}
                strokeDasharray="3 3"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
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

          {/* Crosshair line — relative to plot area, no gutter offset. */}
          {activeIdx !== null && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-fg-tertiary/45"
              style={{ left: `${activePct}%` }}
            />
          )}

          {/* Comparison focus dot — drawn beneath the main dot so the main
              series stays visually dominant. */}
          {activeIdx !== null && activeComparisonPoint && (
            <span
              aria-hidden
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-tertiary opacity-70 ring-[1.5px] ring-bg-primary"
              style={{
                left: `${activePct}%`,
                top: `${activeComparisonYPct}%`,
              }}
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
              {activeComparisonData && (
                <div className="mt-1.5 flex items-center gap-2 border-t border-border/60 pt-1.5 text-xs tabular-nums text-fg-secondary">
                  <span
                    aria-hidden
                    className="inline-block h-[2px] w-3 rounded-full bg-fg-tertiary"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(90deg, var(--fg-tertiary) 0 3px, transparent 3px 6px)",
                    }}
                  />
                  <span>{comparisonLabel}:</span>
                  <span className="text-fg-primary">
                    {fmtValue(activeComparisonData.value)}
                  </span>
                  <span className="text-fg-tertiary">
                    · {formatTooltipDate(activeComparisonData.date, fmtDateLong)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* X-axis date ticks — sit below both gutter and plot area, so we offset
          by the gutter width to align them with the plot. */}
      {showAxes && data.length > 1 && (
        <div className="flex w-full">
          {yAxisLabelWidth > 0 && (
            <div className="shrink-0" style={{ width: yAxisLabelWidth }} aria-hidden />
          )}
          <div
            aria-hidden
            className="relative min-w-0 flex-1 h-3 text-[10px] font-mono tabular-nums text-fg-tertiary"
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
