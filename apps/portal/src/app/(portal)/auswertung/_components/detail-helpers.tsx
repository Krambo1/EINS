import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";

/**
 * Small co-located helpers for the Auswertung deep-dive bundle. Kept inside
 * the page folder to avoid bloating @eins/ui until we've used the same shape
 * on three different pages. Server components — no hooks, no events, no state.
 */

// ---------- Shared tone vocabulary ----------
export type BreakdownTone = "neutral" | "accent" | "good" | "warn" | "bad";

const toneClass: Record<BreakdownTone, string> = {
  neutral: "bg-fg-tertiary/40",
  accent: "bg-accent/55",
  good: "bg-tone-good/55",
  warn: "bg-tone-warn/55",
  bad: "bg-tone-bad/55",
};

// ---------- BreakdownBars: horizontal-bar visualization ----------
export interface BreakdownBarRow {
  label: React.ReactNode;
  value: number;
  /** Optional subtext rendered to the right of the bar. */
  hint?: React.ReactNode;
  tone?: BreakdownTone;
}

export function BreakdownBars({ rows }: { rows: BreakdownBarRow[] }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
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
        const sharePct = total > 0 ? (r.value / total) * 100 : 0;
        const labelStr =
          typeof r.label === "string" ? r.label : `Eintrag ${idx + 1}`;
        return (
          <li
            key={idx}
            className="grid grid-cols-[10rem_1fr_5rem] items-center gap-3 transition hover:[&_.bar]:opacity-100"
          >
            <span className="truncate text-sm text-fg-primary">{r.label}</span>
            <div
              className="relative h-6 cursor-default rounded-full bg-bg-secondary/50"
              title={`${labelStr}: ${r.value.toLocaleString("de-DE")} (${sharePct.toFixed(1).replace(".", ",")} % Anteil)`}
            >
              <div
                className={cn(
                  "bar absolute inset-y-0 left-0 rounded-full opacity-80 transition-opacity",
                  toneClass[r.tone ?? "accent"]
                )}
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

// ---------- FunnelVisualization: horizontal waterfall ----------
//
// Reads left-to-right as the lead's journey. Each stage is a vertical bar
// whose fill height encodes share of the original cohort. Between every
// pair of bars sits the conversion % (focal point) and absolute drop-off
// — the answer to "how many did I lose here?" should jump out without
// reading any axis or hint text.
export interface FunnelStage {
  label: string;
  value: number;
  /** Optional subtext rendered under the stage label (unused by the
   *  waterfall layout but kept for API compatibility with old callers). */
  hint?: React.ReactNode;
}

export function FunnelVisualization({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.value ?? 0;
  if (top === 0) {
    return (
      <p className="py-4 text-sm text-fg-secondary">Keine Trichter-Daten.</p>
    );
  }
  const BAR_HEIGHT_PX = 168;
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
      {stages.map((s, i) => {
        const pctOfTop = top > 0 ? s.value / top : 0;
        const fillPct = pctOfTop * 100;
        const isLast = i === stages.length - 1;
        const prev = stages[i - 1];
        const dropoff = prev ? Math.max(0, prev.value - s.value) : 0;
        const stepConvPct =
          prev && prev.value > 0 ? (s.value / prev.value) * 100 : 0;
        const stepConvTone =
          stepConvPct >= 60
            ? "text-tone-good"
            : stepConvPct >= 30
              ? "text-fg-primary"
              : "text-tone-warn";
        const fillVar = isLast ? "var(--tone-good)" : "var(--accent)";
        const fillColor = `color-mix(in srgb, ${fillVar} 78%, transparent)`;
        const trackColor = `color-mix(in srgb, ${fillVar} 10%, var(--bg-secondary))`;
        const fromTopLabel =
          pctOfTop > 0
            ? `${(pctOfTop * 100).toFixed(0)} % der Anfragen`
            : "0 % der Anfragen";

        return (
          <React.Fragment key={s.label}>
            {i > 0 && (
              <div
                className="flex shrink-0 flex-col items-center justify-center gap-1 px-2 text-xs tabular-nums"
                style={{ height: `${BAR_HEIGHT_PX}px` }}
                aria-hidden
                title={`${prev!.label} → ${s.label}: ${stepConvPct
                  .toFixed(1)
                  .replace(".", ",")} % Konversion · −${dropoff.toLocaleString(
                  "de-DE"
                )}`}
              >
                <ChevronRight className="h-4 w-4 text-fg-tertiary" />
                <span
                  className={cn(
                    "font-display text-lg font-semibold leading-none",
                    stepConvTone
                  )}
                >
                  {stepConvPct.toFixed(0)} %
                </span>
                <span className="text-fg-tertiary">
                  −{dropoff.toLocaleString("de-DE")}
                </span>
              </div>
            )}
            <div
              className="flex min-w-[5rem] flex-1 flex-col items-center"
              title={`${s.label}: ${s.value.toLocaleString("de-DE")} · ${fromTopLabel}`}
            >
              <div className="font-display text-2xl font-semibold tabular-nums leading-none text-fg-primary">
                {s.value.toLocaleString("de-DE")}
              </div>
              <div
                className="relative mt-2 w-full overflow-hidden rounded-md border border-border"
                style={{
                  height: `${BAR_HEIGHT_PX}px`,
                  backgroundColor: trackColor,
                }}
              >
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: `${Math.max(2, fillPct)}%`,
                    backgroundColor: fillColor,
                  }}
                />
              </div>
              <div className="mt-2 text-center text-[11px] font-medium uppercase tracking-wide text-fg-secondary">
                {s.label}
              </div>
              <div className="text-xs tabular-nums text-fg-tertiary">
                {fillPct.toFixed(0)} %
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------- WeekdayHeatmap ----------
export function WeekdayHeatmap({
  rows,
}: {
  rows: { label: string; count: number }[];
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="grid grid-cols-7 gap-2">
      {rows.map((r) => {
        const intensity = max > 0 ? r.count / max : 0;
        const sharePct = total > 0 ? (r.count / total) * 100 : 0;
        return (
          <div key={r.label} className="text-center">
            <div
              className="h-16 w-full cursor-default rounded-md border border-border transition-transform hover:scale-[1.04] hover:border-accent/50"
              style={{
                backgroundColor: `rgba(88, 186, 181, ${0.05 + intensity * 0.45})`,
              }}
              title={`${r.label}: ${r.count.toLocaleString("de-DE")} Anfragen${total > 0 ? ` · ${sharePct.toFixed(1).replace(".", ",")} % der Woche` : ""}`}
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
                className="h-12 w-full cursor-default rounded-sm border border-border transition-transform hover:scale-[1.06] hover:border-accent/50"
                style={{
                  backgroundColor: `rgba(88, 186, 181, ${0.05 + intensity * 0.55})`,
                }}
                title={`${String(r.hour).padStart(2, "0")}:00–${String(r.hour).padStart(2, "0")}:59 · ${r.count.toLocaleString("de-DE")} Anfragen`}
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
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <ul className="space-y-2">
      {buckets.map((b) => {
        const pct = max > 0 ? (b.count / max) * 100 : 0;
        const sharePct = total > 0 ? (b.count / total) * 100 : 0;
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
            <div
              className="relative h-5 cursor-default rounded-full bg-bg-secondary/50"
              title={`${b.label} (${b.min}–${b.max}): ${b.count.toLocaleString("de-DE")} Anfragen${total > 0 ? ` · ${sharePct.toFixed(1).replace(".", ",")} % aller bewerteten Anfragen` : ""}`}
            >
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-opacity hover:opacity-90",
                  toneClass[tone]
                )}
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
