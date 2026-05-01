import * as React from "react";

export interface FunnelStage {
  label: string;
  count: number;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}

const toneFill: Record<NonNullable<FunnelStage["tone"]>, string> = {
  neutral: "bg-bg-tertiary",
  accent: "bg-accent",
  good: "bg-tone-good",
  warn: "bg-tone-warn",
  bad: "bg-tone-bad",
};

/**
 * Stacked horizontal funnel — pure SVG-free CSS bar. Each stage shows its
 * count and percentage of total. Server-rendered.
 */
export function FunnelBar({ stages }: { stages: FunnelStage[] }) {
  const total = stages.reduce((acc, s) => acc + s.count, 0) || 1;

  return (
    <div className="space-y-2">
      <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
        {stages.map((s, i) => {
          const widthPct = (s.count / total) * 100;
          if (widthPct < 0.5) return null;
          return (
            <div
              key={i}
              className={`${toneFill[s.tone ?? "neutral"]} h-full transition-all`}
              style={{ width: `${widthPct}%` }}
              title={`${s.label}: ${s.count}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 md:grid-cols-4">
        {stages.map((s, i) => {
          const pct = ((s.count / total) * 100).toFixed(0);
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${toneFill[s.tone ?? "neutral"]}`}
                aria-hidden
              />
              <span className="truncate text-fg-secondary">{s.label}</span>
              <span className="ml-auto font-mono tabular-nums text-fg-primary">
                {s.count}
              </span>
              <span className="text-fg-tertiary">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
