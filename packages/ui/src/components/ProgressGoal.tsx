import * as React from "react";
import { cn } from "../lib/cn";

export interface ProgressGoalProps {
  /** Current value (e.g. 34 Anfragen diesen Monat) */
  current: number;
  /** Target value (e.g. 30 Ziel-Anfragen) */
  target: number;
  /** Noun for the label — default "Ziel" */
  label: string;
  /** Unit suffix (e.g. "Anfragen", "€") */
  unit?: string;
  /** Optional tone override — by default green if current ≥ target, warn between 70–100 %, bad below */
  tone?: "good" | "warn" | "bad" | "neutral";
  /** Human-readable explainer — e.g. "Das ist sehr gut. Sie liegen über Ziel." */
  caption?: string;
  className?: string;
}

/**
 * ProgressGoal — Ziel-Fortschrittsbalken ("34 von 30 Zielpatienten").
 *
 * Design rule (plan §3.3): numeric progress first, then big bar.
 * Percentage > 100 % stays pinned at 100 % visually but the numeric
 * shows the overshoot.
 */
export function ProgressGoal({
  current,
  target,
  label,
  unit,
  tone,
  caption,
  className,
}: ProgressGoalProps) {
  const safeTarget = target > 0 ? target : 1;
  const rawPct = (current / safeTarget) * 100;
  const visualPct = Math.min(100, Math.max(0, rawPct));

  const derivedTone: NonNullable<ProgressGoalProps["tone"]> =
    tone ??
    (rawPct >= 100 ? "good" : rawPct >= 70 ? "warn" : rawPct >= 40 ? "neutral" : "bad");

  const barColor = {
    good: "bg-tone-good",
    warn: "bg-tone-warn",
    bad: "bg-tone-bad",
    neutral: "bg-accent",
  }[derivedTone];

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base font-semibold text-fg-primary md:text-lg">
          {label}
        </p>
        <p className="text-base font-medium tabular-nums text-fg-primary md:text-lg">
          <span className="text-xl font-semibold md:text-2xl">{current}</span>
          <span className="text-fg-secondary"> von {target}</span>
          {unit && <span className="ml-1 text-fg-secondary">{unit}</span>}
        </p>
      </div>

      <div
        className="h-3 w-full overflow-hidden rounded-full bg-bg-tertiary"
        role="progressbar"
        aria-valuenow={Math.round(rawPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} Fortschritt`}
      >
        <div
          className={cn("h-full transition-all duration-500", barColor)}
          style={{ width: `${visualPct}%` }}
        />
      </div>

      {caption && <p className="opa-caption">{caption}</p>}
    </div>
  );
}
