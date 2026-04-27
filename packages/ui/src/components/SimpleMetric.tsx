"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "../lib/cn";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";

export type MetricTone = "good" | "warn" | "bad" | "neutral";

export interface SimpleMetricProps {
  /** The big number / primary value */
  value: React.ReactNode;
  /** One-line, plain-German label */
  label: string;
  /**
   * "Was bedeutet das für mich" — one sentence in Klartext-Deutsch.
   * e.g. "Das ist sehr gut. Ziel war 30."
   */
  explanation: string;
  /** Traffic-light tone applied to the explanation strip */
  tone?: MetricTone;
  /**
   * Optional deep-dive shown in a popover when the (i) icon is tapped.
   * Use when the explanation needs more room (formula, context).
   */
  detailedExplanation?: React.ReactNode;
  /** Optional prefix/suffix around the value (e.g. "€", "%") */
  unit?: string;
  /** Override font-size helpers for edge cases */
  className?: string;
}

const toneLabel: Record<MetricTone, string> = {
  good: "Das ist sehr gut",
  warn: "Das sollten wir beobachten",
  bad: "Hier sollten wir sprechen",
  neutral: "Das ist normal",
};

const toneStrip: Record<MetricTone, string> = {
  good: "bg-[var(--tone-good-bg)] border-[var(--tone-good-border)] text-tone-good",
  warn: "bg-[var(--tone-warn-bg)] border-[var(--tone-warn-border)] text-tone-warn",
  bad: "bg-[var(--tone-bad-bg)] border-[var(--tone-bad-border)] text-tone-bad",
  neutral:
    "bg-[var(--tone-neutral-bg)] border-[var(--tone-neutral-border)] text-fg-primary",
};

/**
 * SimpleMetric — Opa-proof primary metric tile.
 *
 * Design rules (from plan §3.1):
 *  • Riesige Fonts (60–80 px desktop, 44–56 px mobile).
 *  • Genau ein Erklärsatz in Klartext-Deutsch.
 *  • Ampel-Streifen mit Diagnose-Satz darunter.
 *  • (i)-Icon öffnet Popover mit einfacher Erklärung, nicht Wikipedia.
 *
 * Never put multiple metrics on a single <SimpleMetric>.
 * Compose up to 3 per dashboard (no more).
 */
export function SimpleMetric({
  value,
  label,
  explanation,
  tone = "neutral",
  detailedExplanation,
  unit,
  className,
}: SimpleMetricProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline gap-2">
        <div className="opa-metric text-fg-primary" aria-label={`${value} ${unit ?? ""}`}>
          {value}
          {unit && (
            <span className="ml-1 text-[0.5em] font-normal text-fg-secondary">
              {unit}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <p className="text-xl font-semibold text-fg-primary md:text-2xl">
          {label}
        </p>
        {detailedExplanation && (
          <Popover>
            <PopoverTrigger
              aria-label={`Erklärung für ${label}`}
              className="opa-focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
            >
              <Info className="h-5 w-5" />
            </PopoverTrigger>
            <PopoverContent align="start" className="text-base leading-relaxed">
              {detailedExplanation}
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div
        className={cn(
          "rounded-md border px-3 py-2 text-base font-medium",
          toneStrip[tone]
        )}
      >
        <span className="font-semibold">{toneLabel[tone]}.</span>{" "}
        <span className="font-normal">{explanation}</span>
      </div>
    </div>
  );
}
