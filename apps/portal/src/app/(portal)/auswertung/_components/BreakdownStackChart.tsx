"use client";

import * as React from "react";
import { withBrandLogos } from "@/app/_components/Brand";

// Tone vocabulary mirrors `./detail-helpers` but is inlined so this client
// component doesn't drag the server-only helpers file across the boundary.
type BreakdownTone = "neutral" | "accent" | "good" | "warn" | "bad";

const toneVar: Record<BreakdownTone, string> = {
  neutral: "var(--fg-tertiary)",
  accent: "var(--accent)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
};

const statToneClass: Record<BreakdownTone, string> = {
  neutral: "text-fg-primary",
  accent: "text-fg-primary",
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
};

/**
 * Share-of-total visualization rendered as a single stacked horizontal bar
 * sitting above a values matrix. Each segment is coloured by tone and sized
 * by its share — same vocabulary the donut used, but a bar reads share faster
 * and lays out cleanly above the matrix instead of fighting it for column
 * space inside a half-width card.
 *
 * Slice props are intentionally primitives only (strings/numbers). Passing
 * React nodes from a server-rendering parent costs serialization round-trips
 * that have caused stale hydration in dev; rich content (brand logos, tone-
 * coloured stats) is rebuilt inside this client component.
 */
export interface BreakdownSlice {
  key: string;
  /** Plain-text label, used both in the matrix (via withBrandLogos) and as
   *  the tooltip header. */
  labelText: string;
  value: number;
  tone?: BreakdownTone;
  /** Pre-formatted stat strings, parallel to `legendColumns`. Null = "–". */
  stats?: (string | null)[];
  /** Optional tone hint for the corresponding stat cell (e.g. "good" for a
   *  healthy ROAS, "warn" for one below break-even). */
  statTones?: (BreakdownTone | null)[];
}

export interface BreakdownLegendColumn {
  /** Short uppercase header label (~6 chars). */
  label: string;
}

/** Optional summary row rendered at the bottom of the matrix. Caller computes
 *  cross-slice totals (Σ leads, Σ budget, weighted ROAS) because per-slice
 *  stats are pre-formatted strings and can't be summed here. */
export interface BreakdownTotalsRow {
  /** Row label, e.g. "Gesamt". */
  label: string;
  /** Override for the share cell. Defaults to "100 %". */
  shareLabel?: string;
  /** Pre-formatted stat strings parallel to `legendColumns`. Null = "–". */
  stats: (string | null)[];
  /** Optional tone hint per stat — same vocabulary as `BreakdownSlice.statTones`. */
  statTones?: (BreakdownTone | null)[];
}

export function BreakdownStackChart({
  slices,
  centerLabel = "Gesamt",
  emptyText = "Keine Daten im Zeitraum.",
  legendColumns,
  totalsRow,
}: {
  slices: BreakdownSlice[];
  centerLabel?: string;
  emptyText?: string;
  legendColumns?: BreakdownLegendColumn[];
  totalsRow?: BreakdownTotalsRow;
}) {
  const total = slices.reduce((s, r) => s + r.value, 0);

  // Sort largest first so the dominant slice anchors at the left edge of the
  // bar — mirrors how the donut anchored it at 12 o'clock.
  const sorted = React.useMemo(
    () => [...slices].sort((a, b) => b.value - a.value),
    [slices]
  );

  const [hover, setHover] = React.useState<{
    idx: number;
    x: number;
  } | null>(null);
  const barRef = React.useRef<HTMLDivElement | null>(null);

  if (total === 0) {
    return <p className="py-4 text-sm text-fg-secondary">{emptyText}</p>;
  }

  const updateHoverPosition = (idx: number, e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ idx, x: e.clientX - rect.left });
  };

  const active = hover != null ? sorted[hover.idx] : null;
  const activeShare = active ? (active.value / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-fg-secondary">
            {centerLabel}
          </div>
          <div className="mt-1 font-display text-[2.75rem] font-semibold leading-none tabular-nums text-fg-primary md:text-[3.5rem]">
            {total.toLocaleString("de-DE")}
          </div>
        </div>
      </div>

      <div
        ref={barRef}
        className="relative flex h-9 w-full gap-0.5"
        role="img"
        aria-label={`${centerLabel}: ${total.toLocaleString("de-DE")}`}
      >
        {sorted.map((s, i) => {
          const sharePct = (s.value / total) * 100;
          const isFirst = i === 0;
          const isLast = i === sorted.length - 1;
          const isActive = hover?.idx === i;
          return (
            <div
              key={s.key}
              className={[
                "h-full cursor-default transition-opacity",
                isFirst ? "rounded-l-md" : "",
                isLast ? "rounded-r-md" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                width: `${sharePct}%`,
                backgroundColor: toneVar[s.tone ?? "accent"],
                opacity: hover && !isActive ? 0.5 : 1,
              }}
              onMouseEnter={(e) => updateHoverPosition(i, e)}
              onMouseMove={(e) => updateHoverPosition(i, e)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {active && hover && (
          <BreakdownHoverCard
            slice={active}
            sharePct={activeShare}
            columns={legendColumns}
            x={hover.x}
            containerWidth={barRef.current?.clientWidth ?? 0}
          />
        )}
      </div>

      {/* Meta logo override: the brand lockup defaults to 2em tall (wide
          wordmark + Instagram glyph) which makes its row visibly taller than
          the others. Force it to 1.25em here so matrix rows align. */}
      <table className="w-full text-sm [&_.brand-meta-light]:!h-[1.25em] [&_.brand-meta-light]:!align-[-0.25em] [&_.brand-meta-dark]:!h-[1.25em] [&_.brand-meta-dark]:!align-[-0.25em]">
        {legendColumns && legendColumns.length > 0 && (
          <thead>
            <tr className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
              <th colSpan={2} className="pb-1.5 text-left font-medium">
                <span className="sr-only">Quelle</span>
              </th>
              <th className="pb-1.5 pl-2 text-right font-medium">Anteil</th>
              {legendColumns.map((c) => (
                <th
                  key={c.label}
                  className="pb-1.5 pl-2 text-right font-medium"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {sorted.map((s) => {
            const sharePct = (s.value / total) * 100;
            return (
              <tr key={s.key} className="align-middle">
                <td className="py-1.5 pr-2">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ backgroundColor: toneVar[s.tone ?? "accent"] }}
                  />
                </td>
                <td className="py-1.5 pr-2 text-fg-primary">
                  {withBrandLogos(s.labelText)}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-fg-secondary">
                  {sharePct < 10
                    ? sharePct.toFixed(1).replace(".", ",")
                    : sharePct.toFixed(0)}
                  &nbsp;%
                </td>
                {(legendColumns ?? []).map((_col, i) => {
                  const stat = s.stats?.[i] ?? null;
                  const tone = s.statTones?.[i] ?? null;
                  return (
                    <td
                      key={i}
                      className={`py-1.5 pl-2 text-right tabular-nums ${
                        tone ? statToneClass[tone] : "text-fg-primary"
                      }`}
                    >
                      {stat ?? <span className="text-fg-tertiary">–</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {totalsRow && (
          <tfoot>
            <tr className="border-t-2 border-border align-middle font-semibold">
              <td className="py-2 pr-2" aria-hidden />
              <td className="py-2 pr-2 text-fg-primary">{totalsRow.label}</td>
              <td className="py-2 pl-2 text-right tabular-nums text-fg-primary">
                {totalsRow.shareLabel ?? "100 %"}
              </td>
              {(legendColumns ?? []).map((_col, i) => {
                const stat = totalsRow.stats[i] ?? null;
                const tone = totalsRow.statTones?.[i] ?? null;
                return (
                  <td
                    key={i}
                    className={`py-2 pl-2 text-right tabular-nums ${
                      tone ? statToneClass[tone] : "text-fg-primary"
                    }`}
                  >
                    {stat ?? <span className="text-fg-tertiary">–</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const CARD_WIDTH = 200;
const CARD_GAP = 10;

function BreakdownHoverCard({
  slice,
  sharePct,
  columns,
  x,
  containerWidth,
}: {
  slice: BreakdownSlice;
  sharePct: number;
  columns?: BreakdownLegendColumn[];
  x: number;
  containerWidth: number;
}) {
  const color = toneVar[slice.tone ?? "accent"];
  const shareStr = `${
    sharePct < 10 ? sharePct.toFixed(1).replace(".", ",") : sharePct.toFixed(0)
  } %`;

  // Centre the card on the cursor's x, clamped to the bar bounds so it never
  // bleeds outside the card edge. Sits above the bar (translated up by its
  // own height via -translate-y-full) so it doesn't cover the matrix below.
  const left = Math.max(
    0,
    Math.min(x - CARD_WIDTH / 2, containerWidth - CARD_WIDTH)
  );

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-50 -translate-y-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-left shadow-xl"
      style={{ left, top: -CARD_GAP, width: CARD_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="truncate text-xs font-medium uppercase tracking-wide text-fg-secondary">
          {slice.labelText}
        </span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row label="Anteil" value={shareStr} />
        {columns?.map((c, i) => {
          const stat = slice.stats?.[i] ?? null;
          const tone = slice.statTones?.[i] ?? null;
          return (
            <Row
              key={c.label}
              label={c.label}
              value={stat ?? <span className="text-fg-tertiary">–</span>}
              tone={tone}
            />
          );
        })}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: BreakdownTone | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-fg-secondary">{label}</span>
      <span
        className={`font-display text-sm font-semibold tabular-nums ${
          tone ? statToneClass[tone] : "text-fg-primary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
