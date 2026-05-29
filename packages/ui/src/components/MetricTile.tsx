import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Minus,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { Sparkline, type SparklineTone } from "./Sparkline";

export type MetricTileTone = "neutral" | "good" | "warn" | "bad" | "accent";

export interface MetricDeltaInput {
  /** Percent change. Negative = down. */
  value: number;
  /** Tone applied to the chip. Caller decides whether down is good or bad. */
  tone: "good" | "warn" | "bad" | "neutral";
  /** Optional override for the suffix unit shown next to the number. Defaults to "%". */
  unit?: string;
}

export interface MetricProgressInput {
  /** Current value (e.g. 5 Anfragen) */
  current: number;
  /** Target value (e.g. 30 Anfragen) */
  target: number;
  /**
   * Optional secondary value rendered as a brighter overlay inside the main
   * fill. Used to emphasize a sub-metric — e.g. "of 20 qualified leads,
   * 8 are gewonnen". Always uses the `good` (green) tone for visual contrast
   * against the main fill. Must be ≤ current to be meaningful; clamped
   * visually.
   */
  secondary?: number;
  /**
   * Formatter used for the "Ziel X" label rendered next to the progress bar.
   * Defaults to `Intl.NumberFormat("de-DE")` rounding — pass `formatEuro` for
   * currency tiles, etc.
   */
  formatTarget?: (n: number) => string;
}

export type MetricTileSize = "default" | "large";

export interface MetricTileProps {
  label: string;
  /**
   * Optional node rendered inline next to the label — typically an
   * `ExplainerPopover` (i) bubble. Sits between the label text and the
   * delta chip.
   */
  labelExtra?: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  /**
   * Optional qualitative pill rendered to the right of the headline value
   * (e.g. "Läuft gut" / "Neutral" / "Redebedarf"). Use `MetricStatusBadge`
   * for the canonical look; this slot accepts arbitrary content so callers
   * can swap in custom variants.
   */
  statusBadge?: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: MetricTileTone;
  delta?: MetricDeltaInput;
  sparkline?: number[];
  sparklineTone?: SparklineTone;
  /**
   * Optional override for the sparkline area. When provided, this slot is
   * rendered in place of the static `Sparkline` (e.g. an interactive
   * `TrendChart`). Caller is responsible for sizing.
   */
  chartSlot?: React.ReactNode;
  /**
   * Optional content rendered inside the card *below* the chart. Use for a
   * secondary list / footer block that belongs to the same metric but should
   * sit under the trend (e.g. the open-leads list under the Offene-Anfragen
   * trend). Sits outside the link overlay so its own interactive children
   * (rows linking to a request) stay clickable.
   */
  belowChartSlot?: React.ReactNode;
  /** Optional progress-to-goal bar rendered between sublabel and chart. */
  progress?: MetricProgressInput;
  /** Optional small hint shown right under the progress bar ("Ziel 30 · Monat"). */
  hint?: React.ReactNode;
  /**
   * Optional right-rail slot rendered alongside the value / sublabel /
   * progress / hint stack. Use for a secondary metric or action block that
   * needs visual weight without overflowing the main column (e.g. the
   * response-time + "Jetzt bearbeiten" rail on the Offene Anfragen tile).
   * When provided, the area below the label becomes a two-column flex row;
   * label / labelExtra / delta / controls stay full-width above.
   */
  sideSlot?: React.ReactNode;
  /**
   * Optional toolbar slot rendered above the label (e.g. a per-tile
   * time-range toggle). Left-aligned.
   */
  controls?: React.ReactNode;
  /**
   * Optional click-area overlay. Stretches over the upper region of the
   * card (label through hint, NOT the chart) so the whole header zone is
   * one big click target while the chart area stays free for hover. The
   * consumer is responsible for what the slot renders — typically a
   * framework `Link` styled as `absolute inset-0`.
   *
   * Interactive children inside the upper region (e.g. the `controls`
   * TimeRangeToggle buttons) keep their click handlers — they sit above
   * the link layer via the `pointer-events-none` / `pointer-events-auto`
   * split applied here.
   */
  linkSlot?: React.ReactNode;
  /**
   * Visual density. `large` bumps padding and value type for hero placements
   * like the dashboard top-of-page metrics. Defaults to `default`.
   */
  size?: MetricTileSize;
  className?: string;
}

const toneLabelChip: Record<MetricTileTone, string> = {
  neutral: "border-border bg-bg-secondary text-fg-secondary",
  good: "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] text-tone-good",
  warn: "border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] text-tone-warn",
  bad: "border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] text-tone-bad",
  accent: "border-accent/30 bg-accent-soft text-accent",
};

const valueAccent: Record<MetricTileTone, string> = {
  neutral: "text-fg-primary",
  good: "text-fg-primary",
  warn: "text-fg-primary",
  bad: "text-tone-bad",
  accent: "text-fg-primary",
};

/**
 * MetricTile — high-density admin KPI card with optional delta chip and
 * sparkline. Shares the card-glow visual language but adds the at-a-glance
 * delta + trend that the simpler `SimpleMetric` does not.
 */
export function MetricTile({
  label,
  labelExtra,
  value,
  unit,
  statusBadge,
  sublabel,
  tone = "neutral",
  delta,
  sparkline,
  sparklineTone,
  chartSlot,
  belowChartSlot,
  progress,
  hint,
  sideSlot,
  controls,
  linkSlot,
  size = "default",
  className,
}: MetricTileProps) {
  const isLarge = size === "large";
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-border",
        isLarge ? "p-6 md:p-8" : "p-5 md:p-6",
        className
      )}
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Upper region — label / controls / value / sublabel / progress / hint.
          A wrapper div makes this a single click-zone that linkSlot can
          overlay. flex-1 pushes the chartSlot to the bottom. */}
      <div className="relative isolate flex flex-1 flex-col">
        {linkSlot && (
          <div
            className="absolute inset-0 z-0 [&_*]:rounded-2xl"
            aria-hidden={false}
          >
            {linkSlot}
          </div>
        )}
        <div
          className={cn(
            "relative z-[1] flex flex-1 flex-col",
            linkSlot &&
              "pointer-events-none [&_button]:pointer-events-auto [&_a]:pointer-events-auto"
          )}
        >
          {controls && (
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2",
                isLarge ? "mb-4" : "mb-3"
              )}
            >
              {controls}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            <span
              className={cn(
                "font-medium text-fg-primary",
                isLarge ? "text-xl md:text-2xl" : "text-sm md:text-base"
              )}
            >
              {label}
            </span>
            {labelExtra}
            {delta && <span className="ml-1.5"><DeltaChip {...delta} /></span>}
          </div>
          {(() => {
            const stack = (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex items-baseline gap-1">
                    <span
                      className={cn(
                        "font-display font-semibold tabular-nums leading-none",
                        isLarge
                          ? "text-[2.75rem] md:text-[3.5rem]"
                          : "text-4xl md:text-[2.75rem]",
                        valueAccent[tone]
                      )}
                    >
                      {value}
                    </span>
                    {unit && (
                      <span
                        className={cn(
                          "font-medium text-fg-secondary",
                          isLarge ? "text-lg" : "text-base"
                        )}
                      >
                        {unit}
                      </span>
                    )}
                  </div>
                  {statusBadge && (
                    <div className="shrink-0">{statusBadge}</div>
                  )}
                </div>
                {sublabel && (
                  <div
                    className={cn(
                      "text-fg-secondary",
                      isLarge ? "mt-3 text-sm" : "mt-2 text-xs"
                    )}
                  >
                    {sublabel}
                  </div>
                )}
                {progress && progress.target > 0 && (() => {
                  const ratio = progress.current / progress.target;
                  const fillPct = Math.min(100, Math.max(0, ratio * 100));
                  const reached = ratio >= 1;
                  const empty = progress.current <= 0;
                  const formatVal = progress.formatTarget ?? defaultFormatTarget;
                  const secondaryPct =
                    progress.secondary != null && progress.secondary > 0
                      ? Math.min(100, Math.max(0, (progress.secondary / progress.target) * 100))
                      : null;
                  return (
                    <div
                      className={cn(
                        "flex items-center gap-3",
                        isLarge ? "mt-2" : "mt-1.5"
                      )}
                    >
                      <div
                        className={cn(
                          "relative w-2/5 overflow-hidden rounded-full bg-bg-tertiary",
                          isLarge ? "h-2.5" : "h-2"
                        )}
                        role="progressbar"
                        aria-valuenow={Math.round(fillPct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${label} Fortschritt`}
                      >
                        {/* Fill */}
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${fillPct}%`,
                            background: toneToBarGradient(tone),
                          }}
                        />
                        {secondaryPct != null && (
                          <div
                            className="absolute inset-y-0 left-0 transition-all duration-500"
                            style={{
                              width: `${secondaryPct}%`,
                              background: toneDarkColor(tone),
                            }}
                            aria-hidden
                          />
                        )}
                        {/* Quartile dividers — segment the bar into 4 "cells"
                            so it reads as a goal posts / battery indicator
                            even when empty. Painted in the card background
                            color to look like the fill is carved into
                            milestones. */}
                        <div
                          className="pointer-events-none absolute inset-0 flex"
                          aria-hidden
                        >
                          <div className="h-full flex-1 border-r border-bg-primary" />
                          <div className="h-full flex-1 border-r border-bg-primary" />
                          <div className="h-full flex-1 border-r border-bg-primary" />
                          <div className="h-full flex-1" />
                        </div>
                        {/* Goal flag at 100% — a slim accent notch so the
                            "finish line" is visible even on an empty track. */}
                        <div
                          className={cn(
                            "pointer-events-none absolute inset-y-0 right-0 w-[3px] transition-colors duration-500",
                            reached ? "bg-tone-good" : "bg-fg-tertiary/50"
                          )}
                          aria-hidden
                        />
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-semibold tabular-nums",
                          isLarge ? "text-sm" : "text-xs",
                          reached
                            ? "text-tone-good"
                            : empty
                            ? "text-fg-tertiary"
                            : "text-fg-secondary"
                        )}
                      >
                        <span>{formatVal(progress.current)}</span>
                        <span className="text-fg-tertiary">
                          / {formatVal(progress.target)}
                        </span>
                        {reached && (
                          <Check
                            className="ml-0.5 h-3.5 w-3.5 text-tone-good"
                            strokeWidth={3}
                            aria-hidden
                          />
                        )}
                      </span>
                    </div>
                  );
                })()}
                {hint && (
                  <div
                    className={cn(
                      "text-fg-tertiary",
                      isLarge ? "mt-2 text-xs" : "mt-1.5 text-[11px]"
                    )}
                  >
                    {hint}
                  </div>
                )}
              </>
            );
            return (
              <div className={cn(isLarge ? "mt-4" : "mt-3")}>
                {sideSlot ? (
                  <div className="flex items-start gap-5 md:gap-6">
                    <div className="min-w-0 flex-1">{stack}</div>
                    <div className="shrink-0">{sideSlot}</div>
                  </div>
                ) : (
                  stack
                )}
              </div>
            );
          })()}
        </div>
      </div>
      {/* Chart at the bottom, OUTSIDE the link overlay so hover tooltips
          stay responsive even when linkSlot is set. */}
      {chartSlot ? (
        <div className={cn(isLarge ? "pt-5" : "pt-4")}>{chartSlot}</div>
      ) : (
        sparkline &&
        sparkline.length > 0 && (
          <div className={cn(isLarge ? "pt-5" : "pt-4")}>
            <Sparkline
              values={sparkline}
              tone={sparklineTone ?? toneToSparklineTone(tone)}
            />
          </div>
        )
      )}
      {belowChartSlot && (
        <div className={cn(isLarge ? "pt-5" : "pt-4")}>{belowChartSlot}</div>
      )}
    </div>
  );
}

export type MetricStatus = "gut" | "knapp" | "neutral" | "redebedarf";

interface StatusChipDef {
  label: string;
  tone: MetricTileTone;
  Icon: LucideIcon;
  /** Single-color version of the tone — used for the leading icon background. */
  swatchVar: string;
}

const statusChip: Record<MetricStatus, StatusChipDef> = {
  gut: {
    label: "Läuft gut",
    tone: "good",
    Icon: TrendingUp,
    swatchVar: "var(--tone-good)",
  },
  knapp: {
    label: "Knapp am Ziel",
    tone: "warn",
    Icon: AlertCircle,
    swatchVar: "var(--tone-warn)",
  },
  neutral: {
    label: "Neutral",
    tone: "neutral",
    Icon: Minus,
    swatchVar: "var(--fg-secondary)",
  },
  redebedarf: {
    label: "Redebedarf",
    tone: "bad",
    Icon: AlertTriangle,
    swatchVar: "var(--tone-bad)",
  },
};

/**
 * Maps a `MetricTileTone` (already computed from goal ratio or delta) to one
 * of the three qualitative labels used on the dashboard top metrics.
 */
export function metricStatusFromTone(tone: MetricTileTone): MetricStatus {
  if (tone === "good") return "gut";
  if (tone === "warn") return "knapp";
  if (tone === "bad") return "redebedarf";
  return "neutral";
}

export interface MetricStatusBadgeProps {
  status: MetricStatus;
  /** Optional override for the visible text. */
  label?: string;
  /** Optional override for the leading icon. */
  icon?: LucideIcon;
  className?: string;
}

/**
 * Compact qualitative status indicator rendered alongside a `MetricTile`
 * headline value. Three canonical variants — "Läuft gut", "Neutral",
 * "Redebedarf" — keyed by `MetricStatus`. Renders as a single colored circle
 * with the status icon inside; the textual label is exposed via `aria-label`
 * and a hover tooltip rather than visible chrome.
 */
export function MetricStatusBadge({
  status,
  label,
  icon,
  className,
}: MetricStatusBadgeProps) {
  const { label: defaultLabel, Icon: DefaultIcon, swatchVar } = statusChip[status];
  const Icon = icon ?? DefaultIcon;
  const text = label ?? defaultLabel;
  // Lucide's AlertTriangle is geometrically centered in its 24x24 viewBox
  // but its visual mass sits below center (apex y=4, base y=21 -> centroid
  // y=15.3). Flex-centering the SVG box therefore leaves the triangle
  // looking low and slightly right inside the red disk. A 1px upward nudge
  // brings the optical center onto the circle center. Other status icons
  // (TrendingUp, AlertCircle, Minus) are symmetric and don't need it.
  const needsOpticalNudge = Icon === AlertTriangle;
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full text-white",
        className
      )}
      style={{ background: swatchVar }}
    >
      <Icon
        className={cn("h-4 w-4", needsOpticalNudge && "-translate-y-px")}
        strokeWidth={2.5}
      />
    </span>
  );
}

function DeltaChip({ value, tone, unit = "%" }: MetricDeltaInput) {
  const Icon = value > 0.05 ? ArrowUp : value < -0.05 ? ArrowDown : ArrowRight;
  const sign = value > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        toneLabelChip[tone]
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {sign}
      {value.toFixed(1)}
      {unit}
    </span>
  );
}

function toneToSparklineTone(t: MetricTileTone): SparklineTone {
  if (t === "good") return "good";
  if (t === "warn") return "warn";
  if (t === "bad") return "bad";
  if (t === "accent") return "accent";
  return "neutral";
}

const targetFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
function defaultFormatTarget(n: number): string {
  return targetFormatter.format(n);
}

/**
 * Subtle left-to-right gradient on the progress fill: 15% lighter on the
 * left, base tone on the right. Gives the bar a soft sheen without changing
 * its perceived color.
 */
function toneToBarGradient(t: MetricTileTone): string {
  const v = toneToVar(t);
  return `linear-gradient(90deg, color-mix(in srgb, ${v} 82%, white) 0%, ${v} 100%)`;
}

function toneToVar(t: MetricTileTone): string {
  if (t === "good") return "var(--tone-good)";
  if (t === "warn") return "var(--tone-warn)";
  if (t === "bad") return "var(--tone-bad)";
  if (t === "accent") return "var(--accent)";
  return "var(--fg-secondary)";
}

/**
 * Returns the darkened CSS color string used by the secondary bar overlay.
 * Exported so callers can match adjacent text (e.g. the "X davon gewonnen"
 * sublabel) to the same shade as the secondary fill.
 */
export function toneDarkColor(t: MetricTileTone): string {
  return `color-mix(in srgb, ${toneToVar(t)} 55%, black)`;
}
