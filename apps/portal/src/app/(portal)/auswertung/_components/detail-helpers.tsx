import * as React from "react";
import { cn } from "@eins/ui";

/**
 * Small co-located helpers for Auswertung Detail mode. Kept inside the page
 * folder to avoid bloating @eins/ui until we've used the same shape on
 * three different pages. Server components — no hooks, no events, no state.
 */

// ---------- BreakdownBars: horizontal-bar visualization ----------
export interface BreakdownBarRow {
  label: React.ReactNode;
  value: number;
  /** Optional subtext rendered to the right of the bar. */
  hint?: React.ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
}

const toneClass: Record<NonNullable<BreakdownBarRow["tone"]>, string> = {
  neutral: "bg-fg-tertiary/40",
  accent: "bg-accent/55",
  good: "bg-tone-good/55",
  warn: "bg-tone-warn/55",
  bad: "bg-tone-bad/55",
};

export function BreakdownBars({ rows }: { rows: BreakdownBarRow[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  if (max === 0) {
    return (
      <p className="py-4 text-sm text-fg-secondary">Keine Daten im Zeitraum.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((r, idx) => {
        const pct = (r.value / max) * 100;
        return (
          <li key={idx} className="grid grid-cols-[10rem_1fr_5rem] items-center gap-3">
            <span className="truncate text-sm text-fg-primary">{r.label}</span>
            <div className="relative h-6 rounded-full bg-bg-secondary/50">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", toneClass[r.tone ?? "accent"])}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <span className="text-right text-sm tabular-nums text-fg-secondary">
              {r.hint}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- FunnelVisualization: width-proportional stacked rows ----------
export interface FunnelStage {
  label: string;
  value: number;
  hint?: React.ReactNode;
}

export function FunnelVisualization({ stages }: { stages: FunnelStage[] }) {
  const max = stages.reduce((m, s) => Math.max(m, s.value), 0);
  if (max === 0) {
    return (
      <p className="py-4 text-sm text-fg-secondary">Keine Trichter-Daten.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const tone = i === 0 ? "accent" : i === stages.length - 1 ? "good" : "neutral";
        return (
          <li key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs uppercase tracking-wide text-fg-secondary">
              <span>{s.label}</span>
              <span className="tabular-nums">{s.hint}</span>
            </div>
            <div className="h-9 rounded-md bg-bg-secondary/40">
              <div
                className={cn("h-full rounded-md", toneClass[tone])}
                style={{ width: `${Math.max(8, pct)}%` }}
              />
            </div>
            <div className="text-right text-sm font-semibold tabular-nums text-fg-primary">
              {s.value.toLocaleString("de-DE")}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- WeekdayHeatmap ----------
export function WeekdayHeatmap({
  rows,
}: {
  rows: { label: string; count: number }[];
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="grid grid-cols-7 gap-2">
      {rows.map((r) => {
        const intensity = max > 0 ? r.count / max : 0;
        return (
          <div key={r.label} className="text-center">
            <div
              className="h-16 w-full rounded-md border border-border"
              style={{
                backgroundColor: `rgba(88, 186, 181, ${0.05 + intensity * 0.45})`,
              }}
            >
              <div className="flex h-full items-center justify-center font-display text-lg tabular-nums text-fg-primary">
                {r.count}
              </div>
            </div>
            <div className="mt-1 text-xs text-fg-secondary">{r.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- HourlyHeatmap ----------
export function HourlyHeatmap({
  rows,
}: {
  rows: { hour: number; count: number }[];
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[40rem] gap-1">
        {rows.map((r) => {
          const intensity = max > 0 ? r.count / max : 0;
          return (
            <div key={r.hour} className="flex-1 text-center">
              <div
                className="h-12 w-full rounded-sm border border-border"
                style={{
                  backgroundColor: `rgba(88, 186, 181, ${0.05 + intensity * 0.55})`,
                }}
                title={`${r.hour}:00 — ${r.count} Anfragen`}
              />
              <div className="mt-1 text-[10px] text-fg-secondary tabular-nums">
                {r.hour}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- ScoreDistribution: horizontal bars for the 4 buckets ----------
export function ScoreDistribution({
  buckets,
}: {
  buckets: { label: string; count: number; min: number; max: number }[];
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <ul className="space-y-2">
      {buckets.map((b) => {
        const pct = max > 0 ? (b.count / max) * 100 : 0;
        const tone =
          b.min >= 75 ? "good" : b.min >= 50 ? "accent" : b.min >= 25 ? "warn" : "bad";
        return (
          <li key={b.label} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3">
            <span className="text-sm">
              <span className="font-medium text-fg-primary">{b.label}</span>
              <span className="ml-1 text-xs text-fg-secondary">
                ({b.min}–{b.max})
              </span>
            </span>
            <div className="relative h-5 rounded-full bg-bg-secondary/50">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", toneClass[tone])}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <span className="text-right text-sm tabular-nums text-fg-secondary">
              {b.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- DataTable: lightweight typed table ----------
export interface DataTableColumn<T> {
  key: keyof T | string;
  header: React.ReactNode;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  empty = "Keine Einträge.",
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-fg-secondary">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary/50 text-left text-xs font-medium uppercase tracking-wide text-fg-secondary">
          <tr>
            {columns.map((c) => (
              <th
                key={String(c.key)}
                className={cn(
                  "px-4 py-2.5",
                  c.align === "right" ? "text-right" : "text-left"
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, idx) => (
            <tr key={idx} className="hover:bg-bg-secondary/30">
              {columns.map((c) => (
                <td
                  key={String(c.key)}
                  className={cn(
                    "px-4 py-2.5 tabular-nums",
                    c.align === "right" ? "text-right" : "text-left"
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
