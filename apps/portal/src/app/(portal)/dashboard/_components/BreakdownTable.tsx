"use client";

import * as React from "react";
import { cn } from "@eins/ui";
import { TABLE_HEAD, TABLE_ROW, WASH_AREA, WASH_ROW } from "./dash-ui";

/** Text tone of one figure: zero recedes, Werbeertrag is coloured by band. */
export type FigureTone = "muted" | "quiet" | "good" | "warn";

const toneClass: Record<FigureTone, string> = {
  muted: "text-fg-tertiary",
  quiet: "text-fg-secondary",
  good: "text-tone-good",
  warn: "text-tone-warn",
};

export interface TableColumn {
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
  tones?: (FigureTone | null)[];
}

/**
 * Stripe's breakdown rows (Behandlungen, Standorte): a header, one row per
 * item with its figures in fixed columns (an optional mark before the name)
 * and a bold Gesamt row. With a chart above (Standorte), hovering a row tells
 * it through `onHot` and `hotKey` marks the row the chart points at. All
 * columns from lg; below that only the `phone` columns keep one and the rest
 * move into a line under the name.
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
  columns: TableColumn[];
  rows: TableRow[];
  total?: (string | null)[];
  /** The row the chart above points at, marked like a hovered row. */
  hotKey?: string | null;
  onHot?: (key: string | null) => void;
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
    "grid items-center gap-x-4 [grid-template-columns:var(--cols-phone)] lg:[grid-template-columns:var(--cols-wide)]";
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
            // -mx-3 px-3: a scroll box must not clip the rows' grey, which
            // reaches 12 px past the content (WASH_AREA).
            "-mx-3 px-3",
            listClassName && "scroll-shadows [--scroll-bg:var(--surface-tile)]",
            listClassName
          )}
        >
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          // Below lg a line of figures under the name: two lines get 12 px
          // above and below, one line 8 px (44 px with the white), and the
          // radius follows the height (DESIGN.md section 5).
          const twoLine = restOf(columns, r.cells).length > 0;
          return (
          <li key={r.key} className={WASH_ROW}>
            <div
              onMouseEnter={onHot && (() => onHot(r.key))}
              onMouseLeave={onHot && (() => onHot(null))}
              className={cn(
                rowGrid,
                TABLE_ROW,
                WASH_AREA,
                "min-h-9 hover:bg-[var(--hover-wash)]",
                twoLine
                  ? "rounded-[var(--r-panel)] py-3 lg:rounded-[var(--r-control)] lg:py-2"
                  : "rounded-[var(--r-control)]",
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
            </div>
          </li>
          );
        })}
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

/** Below lg, the figures without a column of their own ("Anfragen 3"). */
function restOf(columns: TableColumn[], cells: (string | null)[], reserve = false): string[] {
  return columns
    .map((c, i) =>
      !c.phone && cells[i] && (reserve || cells[i] !== "–") ? `${c.label} ${cells[i]}` : null
    )
    .filter((t): t is string => t != null);
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
  columns: TableColumn[];
  cells: (string | null)[];
  /** The Gesamt row: the line under the name keeps its room (and shows "–"),
   *  so the row has one height whether or not the period has figures. */
  reserve?: boolean;
}) {
  const rest = restOf(columns, cells, reserve);
  const lines = columns.filter((c) => !c.phone).length > 2 ? "min-h-10" : "min-h-5";
  return (
    <span className="flex min-w-0 items-center gap-3">
      {mark}
      <span className="min-w-0">
        {/* Long names wrap, never cut. */}
        <span className="block break-words text-[15px] font-medium leading-5 text-fg-primary hyphens-auto">{name}</span>
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

/**
 * A number in one of the fixed figure columns; empty when there is none.
 * Medium, like the names: the display face's regular is too thin to read at
 * 15 px (Karam, 2026-10-30). Gesamt stays semibold above it.
 */
function Figure({
  label,
  value,
  tone,
  strong = false,
  className,
}: {
  label: string;
  value: string | null;
  tone?: FigureTone | null;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-right text-[15px] leading-5 tabular-nums",
        strong ? "font-semibold" : "font-medium",
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
