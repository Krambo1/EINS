import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
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

export interface MetricTileProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sublabel?: React.ReactNode;
  tone?: MetricTileTone;
  delta?: MetricDeltaInput;
  sparkline?: number[];
  sparklineTone?: SparklineTone;
  /** Optional small hint shown under the sparkline ("vs. Vormonat"). */
  hint?: React.ReactNode;
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
  value,
  unit,
  sublabel,
  tone = "neutral",
  delta,
  sparkline,
  sparklineTone,
  hint,
  className,
}: MetricTileProps) {
  return (
    <div
      className={cn(
        "card-glow rounded-2xl border border-border bg-bg-secondary/60 p-5 backdrop-blur-sm md:p-6",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          {label}
        </span>
        {delta && <DeltaChip {...delta} />}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={cn(
            "font-display text-4xl font-semibold tabular-nums leading-none md:text-[2.75rem]",
            valueAccent[tone]
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-base font-medium text-fg-secondary">{unit}</span>
        )}
      </div>
      {sublabel && (
        <div className="mt-2 text-xs text-fg-secondary">{sublabel}</div>
      )}
      {sparkline && sparkline.length > 0 && (
        <div className="mt-4">
          <Sparkline
            values={sparkline}
            tone={sparklineTone ?? toneToSparklineTone(tone)}
            height={36}
          />
        </div>
      )}
      {hint && <div className="mt-2 text-[11px] text-fg-tertiary">{hint}</div>}
    </div>
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
