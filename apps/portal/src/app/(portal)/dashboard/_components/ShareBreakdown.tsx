"use client";

import * as React from "react";
import { cn } from "@eins/ui";
import { HOVER_CARD, HoverCardBody, LIT_FROM_ABOVE, type HoverCardLine } from "./hover-card";
import { BreakdownTable, type PairedColumn, type TableRow } from "./PairedBreakdown";

/** One colour per Standort, in row order; "Ohne Standort" stays grey. */
const SHARE_COLORS = ["var(--accent)", "#4f7fe8", "#a77be3", "#f0a43a", "#e0679a", "#45b26b"];
const UNASSIGNED = "#d3d6dd";

/** One Standort: its row plus its piece of every share bar. */
export interface ShareRow extends TableRow {
  /** Raw values per bar, in `metrics` order (bar widths). */
  values: number[];
  /** Lines of the hover card; the hovered bar's line also gets the share. */
  card: HoverCardLine[];
  /** Anfragen without a Standort: grey instead of a colour of its own. */
  unassigned?: boolean;
}

/**
 * Standorte: Attio's segmented bars laid on their side, one bar per figure
 * (Anfragen, Termine, Gewonnen, Umsatz), each split into the Standorte's
 * shares in their own colours, over Stripe's legend rows (colour square,
 * name, figures) and a Gesamt row. A Praxis has two to a handful of
 * Standorte, so the question is who carries how much, not a ranking.
 *
 * Standort and row belong together: hovering a piece or a row marks the
 * Standort in every bar and dims the others; a hovered piece shows a card
 * with that Standort's figures and its share of that bar.
 */
export function ShareBreakdown({
  nameLabel,
  metrics,
  columns,
  rows,
  total,
  chartLabel,
  emptyText,
  listClassName,
}: {
  nameLabel: string;
  /** Labels of the bars; each row's `values` follow this order. */
  metrics: string[];
  columns: PairedColumn[];
  rows: ShareRow[];
  total?: (string | null)[];
  chartLabel: string;
  /** No figure in this period: the bars give way to this sentence (same
   *  space, centred); the rows below keep their place with "–". */
  emptyText?: string;
  /** Fixed height of the rows' space; see `BreakdownTable`. */
  listClassName?: string;
}) {
  const [hot, setHot] = React.useState<string | null>(null);
  const [piece, setPiece] = React.useState<{ key: string; metric: number } | null>(null);
  const valid = (k: string | null) => (k != null && rows.some((r) => r.key === k) ? k : null);
  const hotKey = valid(piece?.key ?? hot);
  const colorOf = (r: TableRow) => {
    const row = rows.find((x) => x.key === r.key);
    const i = rows.findIndex((x) => x.key === r.key);
    return row?.unassigned ? UNASSIGNED : SHARE_COLORS[i % SHARE_COLORS.length]!;
  };

  const allEmpty = metrics.every((_, mi) => rows.every((r) => (r.values[mi] ?? 0) <= 0));
  return (
    <div>
      {emptyText && allEmpty ? (
        // Same height as the bars it stands in for: one 24 px bar per metric,
        // 12 px between them.
        <div
          className="elev-inset flex items-center justify-center rounded-[var(--r-panel)] bg-[var(--well)] px-4 text-center text-[15px] leading-5 text-fg-secondary"
          style={{ height: `calc(${metrics.length} * 1.5rem + ${metrics.length - 1} * 0.75rem)` }}
        >
          {emptyText}
        </div>
      ) : (
      <div role="img" aria-label={chartLabel} className="space-y-3">
        {metrics.map((m, mi) => {
          const sum = rows.reduce((a, r) => a + Math.max(0, r.values[mi] ?? 0), 0);
          return (
            <div key={m} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-4 px-2">
              <span className="text-sm text-fg-secondary">{m}</span>
              {sum > 0 ? (
                <div
                  className="anim-wipe flex h-6 gap-0.5"
                  style={{ "--delay": `${mi * 60}ms` } as React.CSSProperties}
                >
                  {rows.map((r) => {
                    const v = Math.max(0, r.values[mi] ?? 0);
                    if (v === 0) return null;
                    const pct = Math.round((v / sum) * 100);
                    const open = piece?.key === r.key && piece.metric === mi;
                    return (
                      <div
                        key={r.key}
                        onMouseEnter={() => setPiece({ key: r.key, metric: mi })}
                        onMouseLeave={() => setPiece(null)}
                        className={cn(
                          "relative min-w-1.5 transition-opacity duration-200 first:rounded-l-[var(--r-small)] last:rounded-r-[var(--r-small)]",
                          hotKey != null && hotKey !== r.key && "opacity-40"
                        )}
                        style={{
                          flex: `${v} 1 0%`,
                          backgroundColor: colorOf(r),
                          backgroundImage: LIT_FROM_ABOVE,
                          boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.35)",
                        }}
                      >
                        {open && (
                          <div className={cn(HOVER_CARD, "left-1/2 -translate-x-1/2")}>
                            <HoverCardBody
                              title={r.name}
                              color={colorOf(r)}
                              lines={r.card.map((l) => (l.label === m ? { ...l, extra: `${pct} %` } : l))}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                // Nothing in this period: an empty track pressed into the card.
                <div className="elev-inset h-6 rounded-[var(--r-small)] bg-[var(--well)]" />
              )}
            </div>
          );
        })}
      </div>
      )}
      <BreakdownTable
        className="mt-6"
        nameLabel={nameLabel}
        columns={columns}
        rows={rows}
        total={total}
        hotKey={hotKey}
        onHot={setHot}
        listClassName={listClassName}
        markOf={(r) => (
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[var(--r-mark)]"
            style={{ backgroundColor: colorOf(r), backgroundImage: LIT_FROM_ABOVE }}
          />
        )}
      />
    </div>
  );
}
