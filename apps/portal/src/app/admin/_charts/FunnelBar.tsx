"use client";

import * as React from "react";
import { ChartTooltipCard } from "./ChartTooltip";

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

const toneSwatch: Record<NonNullable<FunnelStage["tone"]>, string> = {
  neutral: "var(--bg-tertiary)",
  accent: "var(--accent)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
};

const numFormatter = new Intl.NumberFormat("de-DE");

/**
 * Stacked horizontal funnel — pure CSS bar. Each stage shows its count and
 * percentage of total. Hover any segment for a tooltip card with stage name,
 * absolute count, percentage of total, and conversion vs. the previous stage.
 */
export function FunnelBar({ stages }: { stages: FunnelStage[] }) {
  const total = stages.reduce((acc, s) => acc + s.count, 0) || 1;

  const [hover, setHover] = React.useState<
    | { index: number; x: number; y: number }
    | null
  >(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  function handleEnter(
    e: React.PointerEvent<HTMLDivElement>,
    index: number
  ) {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setHover({
      index,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    setHover((prev) => {
      if (!prev) return prev;
      const wrap = wrapperRef.current;
      if (!wrap) return prev;
      const rect = wrap.getBoundingClientRect();
      return { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top };
    });
  }

  function handleLeave() {
    setHover(null);
  }

  const activeStage = hover != null ? stages[hover.index] : null;
  const activePrev =
    hover != null && hover.index > 0 ? stages[hover.index - 1] : null;
  const activePct = activeStage
    ? ((activeStage.count / total) * 100).toFixed(0)
    : null;
  const stepConv =
    activeStage && activePrev && activePrev.count > 0
      ? ((activeStage.count / activePrev.count) * 100).toFixed(0)
      : null;

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className="relative flex h-8 w-full overflow-visible rounded-md border border-border"
      >
        <div className="flex h-full w-full overflow-hidden rounded-md">
          {stages.map((s, i) => {
            const widthPct = (s.count / total) * 100;
            if (widthPct < 0.5) return null;
            const isActive = hover?.index === i;
            return (
              <div
                key={i}
                className={`${toneFill[s.tone ?? "neutral"]} h-full transition-all duration-150`}
                style={{
                  width: `${widthPct}%`,
                  filter: isActive ? "brightness(1.1)" : undefined,
                  boxShadow: isActive
                    ? "inset 0 0 0 1.5px var(--fg-primary)"
                    : undefined,
                }}
                onPointerEnter={(e) => handleEnter(e, i)}
                onPointerMove={handleMove}
                onPointerLeave={handleLeave}
              />
            );
          })}
        </div>

        {hover && activeStage && (
          <div
            className="pointer-events-none absolute z-50"
            style={{
              left: hover.x,
              top: hover.y,
              transform: "translate(-50%, calc(-100% - 12px))",
            }}
          >
            <ChartTooltipCard
              header={activeStage.label}
              rows={[
                {
                  name: "Anzahl",
                  value: `${numFormatter.format(activeStage.count)}${
                    activePct != null ? ` · ${activePct} %` : ""
                  }`,
                  color: toneSwatch[activeStage.tone ?? "neutral"],
                },
                ...(stepConv != null
                  ? [
                      {
                        name: `Konversion ab ${activePrev!.label}`,
                        value: `${stepConv} %`,
                        color: "var(--fg-tertiary)",
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
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
