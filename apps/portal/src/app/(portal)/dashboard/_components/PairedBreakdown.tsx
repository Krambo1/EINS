"use client";

import * as React from "react";
import { cn } from "@eins/ui";
import { COLUMN_CLIP, ChartFloor, HOVER_CARD, HoverCardBody, type HoverCardLine } from "./hover-card";
import { TABLE_HEAD, TABLE_ROW } from "./dash-ui";

/** Text tone of one figure: zero recedes, Werbeertrag is coloured by band. */
export type PairedTone = "muted" | "quiet" | "good" | "warn";

const toneClass: Record<PairedTone, string> = {
  muted: "text-fg-tertiary",
  quiet: "text-fg-secondary",
  good: "text-tone-good",
  warn: "text-tone-warn",
};

export interface PairedColumn {
  label: string;
  /** Keeps its own column on the phone; the others move into a line under
   *  the name there. */
  phone?: boolean;
}

/**
 * One row of a breakdown table. Props are primitives only (the server parent
 * pre-formats every figure), like the Quellen rows.
 */
export interface TableRow {
  key: string;
  name: string;
  /** Figures in column order, pre-formatted. Null: empty cell. */
  cells: (string | null)[];
  tones?: (PairedTone | null)[];
}

/** One Behandlung: its row plus the two bars of its group. */
export interface PairedRow extends TableRow {
  /** Light bar. Null: no activity in the period, no bars. */
  anfragen: number | null;
  /** Solid bar beside it. */
  gewonnen: number | null;
  /** Lines of the hover card over the group. */
  card: HoverCardLine[];
}

/**
 * Behandlungen: Attio's grouped bar chart on top (one group per
 * row, a light bar for Anfragen beside a solid one for Gewonnen, a legend
 * above, the name under each group), Stripe's rows below (figures in fixed
 * columns) and a bold Gesamt row like Stripe's total row.
 *
 * Group and row belong together: hovering either one marks both and dims the
 * other groups, and the group shows a card with its figures. The chart shows
 * from lg and only while every name fits under its group in full; otherwise
 * the rows carry the figures alone. All figure columns
 * show from lg; below that only the `phone` columns keep one and the rest
 * move into a line under the name.
 */
export function PairedBreakdown({
  nameLabel,
  columns,
  rows,
  total,
  chartLabel,
  emptyText,
  listClassName,
}: {
  /** Header of the name column ("Behandlung", "Standort"). */
  nameLabel: string;
  columns: PairedColumn[];
  rows: PairedRow[];
  /** Gesamt row: figures in column order. */
  total?: (string | null)[];
  /** Screen-reader sentence for the chart. */
  chartLabel: string;
  /** Nothing to show in this period: the rows give way to this sentence, in
   *  the same space. The chart keeps its plot area. */
  emptyText?: string;
  /** Fixed height of the rows' space (and its scrolling). */
  listClassName?: string;
}) {
  const [hot, setHot] = React.useState<string | null>(null);
  const hotKey = hot != null && rows.some((r) => r.key === hot) ? hot : null;
  return (
    <div>
      <PairedColumns rows={rows} hotKey={hotKey} onHot={setHot} ariaLabel={chartLabel} />
      <BreakdownTable
        nameLabel={nameLabel}
        columns={columns}
        rows={rows}
        total={total}
        hotKey={hotKey}
        onHot={setHot}
        emptyText={emptyText}
        listClassName={listClassName}
      />
    </div>
  );
}

/**
 * Stripe's rows under a breakdown chart: a header, one row per item with its
 * figures in fixed columns (an optional mark before the name) and a bold
 * Gesamt row. Hovering a row marks it and tells the chart above. All columns
 * from lg; below that only the `phone` columns keep one and the rest move
 * into a line under the name.
 */
export function BreakdownTable({
  nameLabel,
  columns,
  rows,
  total,
  hotKey,
  onHot,
  markOf,
  className,
  emptyText,
  listClassName,
}: {
  nameLabel: string;
  columns: PairedColumn[];
  rows: TableRow[];
  total?: (string | null)[];
  hotKey: string | null;
  onHot: (key: string | null) => void;
  /** Mark before a row's name (a colour square), if any. */
  markOf?: (row: TableRow) => React.ReactNode;
  className?: string;
  /** Replaces the rows (same space, centred) when there is nothing to list. */
  emptyText?: string;
  /**
   * Fixed height of the rows' space. Rows that do not fit scroll (soft shadow
   * at the edge), so the card never changes size with its data. Without it
   * the rows take the height they need (other pages).
   */
  listClassName?: string;
}) {
  const phoneCols = columns.filter((c) => c.phone).length;
  const grid = {
    "--cols-phone": `minmax(0,1fr) repeat(${phoneCols}, 5.5rem)`,
    "--cols-wide": `minmax(0,1fr) repeat(${columns.length}, 6rem)`,
  } as React.CSSProperties;
  const rowGrid =
    "grid items-center gap-x-4 px-2 [grid-template-columns:var(--cols-phone)] lg:[grid-template-columns:var(--cols-wide)]";
  return (
    <div style={grid} className={className}>
      <div aria-hidden className={cn(rowGrid, TABLE_HEAD)}>
        <span>{nameLabel}</span>
        {columns.map((c) => (
          <span key={c.label} className={cn("text-right", !c.phone && "hidden lg:block")}>
            {c.label}
          </span>
        ))}
      </div>
      {emptyText ? (
        <div
          className={cn(
            "flex items-center justify-center px-4 text-center text-[15px] leading-5 text-fg-secondary",
            listClassName
          )}
        >
          {emptyText}
        </div>
      ) : (
        <div
          className={cn(
            listClassName && "scroll-shadows [--scroll-bg:var(--surface-tile)]",
            listClassName
          )}
        >
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.key}
            onMouseEnter={() => onHot(r.key)}
            onMouseLeave={() => onHot(null)}
            className={cn(
              rowGrid,
              TABLE_ROW,
              hotKey === r.key && "bg-[var(--hover-wash)]"
            )}
          >
            <NameCell name={r.name} mark={markOf?.(r)} columns={columns} cells={r.cells} />
            {columns.map((c, i) => (
              <Figure
                key={c.label}
                label={c.label}
                value={r.cells[i] ?? null}
                tone={r.tones?.[i] ?? null}
                className={cn(!c.phone && "hidden lg:block")}
              />
            ))}
          </li>
        ))}
      </ul>
        </div>
      )}
      {total && (
        <div
          className={cn(
            rowGrid,
            "border-t border-border pt-3 text-[15px] font-semibold leading-5 text-fg-primary"
          )}
        >
          <NameCell name="Gesamt" columns={columns} cells={total} reserve />
          {columns.map((c, i) => (
            <Figure
              key={c.label}
              label={c.label}
              value={total[i] ?? null}
              strong
              className={cn(!c.phone && "hidden lg:block")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Name, and below lg the figures without a column of their own. */
function NameCell({
  name,
  mark,
  columns,
  cells,
  reserve = false,
}: {
  name: string;
  mark?: React.ReactNode;
  columns: PairedColumn[];
  cells: (string | null)[];
  /** The Gesamt row: the line under the name keeps its room (and shows "–"),
   *  so the row has one height whether or not the period has figures. */
  reserve?: boolean;
}) {
  const rest = columns
    .map((c, i) =>
      !c.phone && cells[i] && (reserve || cells[i] !== "–") ? `${c.label} ${cells[i]}` : null
    )
    .filter((t): t is string => t != null);
  const lines = columns.filter((c) => !c.phone).length > 2 ? "min-h-10" : "min-h-5";
  return (
    <span className="flex min-w-0 items-center gap-3">
      {mark}
      <span className="min-w-0">
        {/* Long names wrap, never cut. */}
        <span className="block break-words text-[15px] leading-5 text-fg-primary hyphens-auto">{name}</span>
        {(rest.length > 0 || reserve) && (
          // Wraps between figures, never inside one ("Gewonnen 3").
          <span
            className={cn(
              "block text-sm font-normal tabular-nums text-fg-secondary lg:hidden",
              reserve && lines
            )}
          >
            {rest.map((t, i) => (
              <React.Fragment key={t}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">{t}</span>
              </React.Fragment>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/** A number in one of the fixed figure columns; empty when there is none. */
function Figure({
  label,
  value,
  tone,
  strong = false,
  className,
}: {
  label: string;
  value: string | null;
  tone?: PairedTone | null;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-right text-[15px] leading-5 tabular-nums",
        strong ? "font-semibold" : "font-normal",
        tone ? toneClass[tone] : "text-fg-primary",
        className
      )}
    >
      {value != null && (
        <>
          <span className="sr-only">{label}: </span>
          {value}
        </>
      )}
    </span>
  );
}

/**
 * Attio's grouped bars: per row a light Anfragen bar beside a solid Gewonnen
 * bar, each with its count above, standing on the base line; dashed gridlines at
 * the top and the middle of the scale; the name under each group. Hovering a
 * group marks its row and floats a card with its figures.
 */
function PairedColumns({
  rows,
  hotKey,
  onHot,
  ariaLabel,
}: {
  rows: PairedRow[];
  hotKey: string | null;
  onHot: (key: string | null) => void;
  ariaLabel: string;
}) {
  const scaleMax = niceCeil(Math.max(1, ...rows.map((r) => r.anfragen ?? 0), ...rows.map((r) => r.gewonnen ?? 0)));
  // Data is never cut to fit: when a name does not fit under its group in
  // full, the chart steps aside and the rows carry the figures alone. Measured,
  // since it depends on the names and the card's width; while hidden the chart
  // keeps its width (no height, invisible), so a wider card brings it back.
  const namesRef = React.useRef<HTMLDivElement>(null);
  const [fits, setFits] = React.useState(true);
  const namesKey = rows.map((r) => r.name).join("\n");
  React.useLayoutEffect(() => {
    const names = namesRef.current;
    if (!names) return;
    const check = () =>
      setFits(Array.from(names.children).every((c) => c.scrollWidth <= c.clientWidth + 1));
    check();
    const ro = new ResizeObserver(check);
    ro.observe(names);
    void document.fonts?.ready.then(check);
    return () => ro.disconnect();
  }, [namesKey]);
  return (
    <div
      aria-hidden={!fits || undefined}
      className={cn("hidden lg:block", fits ? "mb-6" : "invisible h-0 overflow-hidden")}
    >
      <div aria-hidden className="mb-4 flex items-center gap-5 text-sm text-fg-secondary">
        <LegendItem className="bar-light" label="Anfragen" />
        <LegendItem className="bar-solid" label="Gewonnen" />
      </div>
      {/* --area: height of a full-scale bar. Above it room for the count,
          below it the 2 px base line. */}
      <div role="img" aria-label={ariaLabel} className="relative [--area:120px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-7 flex h-[var(--area)] flex-col justify-between"
        >
          <span className="border-t border-dashed border-border" />
          <span className="border-t border-dashed border-border" />
          <span />
        </div>
        <div className="relative" style={{ height: "calc(var(--area) + 1.75rem + 2px)" }}>
          <ChartFloor />
          <div className="flex h-full items-end justify-around gap-2 px-2 pb-0.5">
            {rows.map((r, i) => {
              const dim = hotKey != null && hotKey !== r.key;
              const align = i === 0 ? "left" : i === rows.length - 1 ? "right" : "center";
              return (
                <div
                  key={r.key}
                  onMouseEnter={() => onHot(r.key)}
                  onMouseLeave={() => onHot(null)}
                  className={cn(
                    "relative flex h-full min-w-0 max-w-24 flex-1 items-end justify-center gap-1.5 transition-opacity duration-200",
                    dim && "opacity-40"
                  )}
                >
                  <Bar value={r.anfragen} share={(r.anfragen ?? 0) / scaleMax} tone="light" delay={i * 40} />
                  <Bar value={r.gewonnen} share={(r.gewonnen ?? 0) / scaleMax} tone="solid" delay={i * 40 + 60} />
                  {hotKey === r.key && (
                    <div
                      className={cn(
                        HOVER_CARD,
                        align === "left" && "left-0",
                        align === "right" && "right-0",
                        align === "center" && "left-1/2 -translate-x-1/2"
                      )}
                    >
                      <HoverCardBody title={r.name} color="var(--bar-fill)" lines={r.card} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Names, one under each group, on one line. `truncate` only lets the
            check above see a name that does not fit; the chart then hides. */}
        <div ref={namesRef} aria-hidden className="mt-2 flex justify-around gap-2 px-2">
          {rows.map((r) => (
            <span
              key={r.key}
              title={r.name}
              className={cn(
                "min-w-0 max-w-24 flex-1 truncate text-center text-[13px] leading-4 transition-colors",
                hotKey === r.key ? "text-fg-primary" : "text-fg-secondary"
              )}
            >
              {r.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One bar of a group with its count above; nothing without a value. */
function Bar({
  value,
  share,
  tone,
  delay,
}: {
  value: number | null;
  share: number;
  tone: "light" | "solid";
  delay: number;
}) {
  return (
    <div className="flex h-full w-[40%] max-w-8 flex-col items-center justify-end">
      {value != null && (
        <>
          <span
            className={cn(
              "mb-1.5 text-[13px] font-semibold leading-none tabular-nums",
              tone === "solid" ? "text-fg-primary" : "text-fg-secondary"
            )}
          >
            {value}
          </span>
          <span
            aria-hidden
            className={cn(
              "anim-bar-y block w-full rounded-t-[var(--r-control)]",
              tone === "solid" ? "bar-solid" : "bar-light"
            )}
            style={
              {
                height: value > 0 ? `max(3px, calc(var(--area) * ${share.toFixed(4)}))` : "0px",
                clipPath: COLUMN_CLIP,
                "--delay": `${delay}ms`,
              } as React.CSSProperties
            }
          />
        </>
      )}
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-[var(--r-mark)]", className)} />
      {label}
    </span>
  );
}

/** Smallest of 1, 2, 2.5, 5 times a power of ten that is at least `n`. */
function niceCeil(n: number): number {
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}
