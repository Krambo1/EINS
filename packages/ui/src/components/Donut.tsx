"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export interface DonutSlice {
  name: string;
  value: number;
  /** CSS color (token var or hex). e.g. "var(--accent)", "#1877F2". */
  color: string;
}

/** Serializable value formatter spec for server-component callers. */
export type DonutValueFormat = "number" | "euro" | "chf";

const numberDeFormat = new Intl.NumberFormat("de-DE");
const euroDeFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const chfDeFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "CHF",
  maximumFractionDigits: 0,
});

function resolveFormat(spec?: DonutValueFormat): (n: number) => string {
  switch (spec) {
    case "euro":
      return (n) => (Number.isFinite(n) ? euroDeFormat.format(n) : "–");
    case "chf":
      return (n) => (Number.isFinite(n) ? chfDeFormat.format(n) : "–");
    default:
      return (n) => (Number.isFinite(n) ? numberDeFormat.format(n) : "–");
  }
}

export interface DonutProps {
  slices: DonutSlice[];
  /** Big text in the ring centre (e.g. the total). */
  centerLabel?: React.ReactNode;
  /** Small text under `centerLabel`. */
  centerSubLabel?: React.ReactNode;
  /** Square footprint of the ring, px. Default 220. */
  height?: number;
  /** Serializable tooltip value formatter for server callers. */
  valueFormat?: DonutValueFormat;
  /** Client-only formatter override (wins over `valueFormat`). */
  formatValue?: (n: number) => string;
  /**
   * Render a built-in legend below the ring. Default false — most consumers
   * render their own legend with extra columns next to the donut.
   */
  showLegend?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * SVG arc-ring donut with a center total + hover tooltip. Zero dependencies —
 * the shared-SVG replacement for the admin Recharts PieChart (platform mix,
 * AI-score distribution). Segments are drawn as stroke-dashed circles, which
 * sidesteps large-arc-flag math and renders identically server + client.
 */
export function Donut({
  slices,
  centerLabel,
  centerSubLabel,
  height = 220,
  valueFormat,
  formatValue,
  showLegend = false,
  className,
  ariaLabel,
}: DonutProps) {
  const [active, setActive] = React.useState<number | null>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  const fmt = React.useMemo(
    () =>
      valueFormat
        ? resolveFormat(valueFormat)
        : formatValue ?? ((n: number) => numberDeFormat.format(n)),
    [valueFormat, formatValue]
  );

  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((acc, s) => acc + s.value, 0);

  // Ring geometry in a 100×100 viewBox. Mid-radius circle, stroked thick.
  const cx = 50;
  const cy = 50;
  const strokeW = 14;
  const r = 50 - strokeW / 2 - 1;
  const C = 2 * Math.PI * r;
  // Visual gap between segments (user units along the circumference).
  const GAP = positive.length > 1 ? 2 : 0;

  let cumulative = 0;
  const segments = positive.map((s, i) => {
    const frac = total > 0 ? s.value / total : 0;
    const segLen = frac * C;
    const visLen = Math.max(0.001, segLen - GAP);
    const seg = {
      ...s,
      idx: i,
      frac,
      visLen,
      dashOffset: -cumulative,
    };
    cumulative += segLen;
    return seg;
  });

  function trackPointer(e: React.PointerEvent) {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const activeSlice = active != null ? positive[active] : null;
  const activePct =
    activeSlice && total > 0
      ? Math.round((activeSlice.value / total) * 100)
      : null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        ref={wrapperRef}
        className="relative mx-auto"
        style={{ width: height, height }}
      >
        <svg
          viewBox="0 0 100 100"
          className="block h-full w-full -rotate-90"
          role="img"
          aria-label={ariaLabel}
        >
          {total <= 0 ? (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="var(--bg-tertiary)"
              strokeWidth={strokeW}
            />
          ) : (
            segments.map((seg) => (
              <circle
                key={seg.idx}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={active === seg.idx ? strokeW + 3 : strokeW}
                strokeDasharray={`${seg.visLen} ${C - seg.visLen}`}
                strokeDashoffset={seg.dashOffset}
                className="cursor-default transition-[stroke-width] duration-150"
                style={{ opacity: active == null || active === seg.idx ? 1 : 0.55 }}
                onPointerEnter={(e) => {
                  setActive(seg.idx);
                  trackPointer(e);
                }}
                onPointerMove={trackPointer}
                onPointerLeave={() => {
                  setActive(null);
                  setPos(null);
                }}
              />
            ))
          )}
        </svg>

        {(centerLabel || centerSubLabel) && (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center transition-opacity duration-150"
            style={{ opacity: active != null ? 0 : 1 }}
            aria-hidden={active != null}
          >
            {centerLabel && (
              <div className="font-display text-2xl font-semibold tabular-nums text-fg-primary">
                {centerLabel}
              </div>
            )}
            {centerSubLabel && (
              <div className="mt-0.5 text-[11px] text-fg-secondary">
                {centerSubLabel}
              </div>
            )}
          </div>
        )}

        {activeSlice && pos && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-border bg-bg-secondary px-3 py-2 shadow-lg"
            style={{
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, calc(-100% - 12px))",
            }}
          >
            <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
              {activeSlice.name}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm tabular-nums">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: activeSlice.color }}
              />
              <span className="font-display font-semibold text-fg-primary">
                {fmt(activeSlice.value)}
                {activePct != null ? ` · ${activePct} %` : ""}
              </span>
            </div>
          </div>
        )}
      </div>

      {showLegend && positive.length > 0 && (
        <div className="space-y-1 text-xs">
          {positive.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: s.color }}
              />
              <span className="flex-1 truncate text-fg-primary">{s.name}</span>
              <span className="font-mono tabular-nums text-fg-secondary">
                {fmt(s.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
