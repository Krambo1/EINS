"use client";

import * as React from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { cn } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { withBrandLogos } from "@/app/_components/Brand";
import { COLUMN_CLIP, ChartFloor, HOVER_CARD, HoverCardBody, LIT_FROM_ABOVE } from "./hover-card";

// Tone vocabulary mirrors `./detail-helpers` but is inlined so this client
// component doesn't drag the server-only helpers file across the boundary.
type BreakdownTone = "neutral" | "muted" | "accent" | "good" | "warn" | "bad";

const toneVar: Record<BreakdownTone, string> = {
  neutral: "var(--fg-tertiary)",
  muted: "var(--border-hover)",
  accent: "var(--accent)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
};

const statToneClass: Record<BreakdownTone, string> = {
  neutral: "text-fg-primary",
  muted: "text-fg-primary",
  accent: "text-fg-primary",
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
};

/** Concise plain-Deutsch explainers for the non-obvious economics metrics.
 *  The funnel columns (Anteil · Anfragen · Termine · Gewonnen) are self-
 *  explanatory and intentionally left without a help bubble. */
const ECON_INFO: Record<string, { term: string; text: string }> = {
  cpl: {
    term: "Kosten pro qualifizierter Anfrage",
    text: "Kosten pro qualifizierter Anfrage: Werbebudget geteilt durch die qualifizierten Anfragen aus dieser Quelle. Qualifiziert heißt: über einen EINS-Messweg, mit Telefon oder E-Mail, kein Spam.",
  },
  cac: {
    term: "Kosten pro Patient",
    text: "Kosten pro gewonnenem Patienten: Werbebudget geteilt durch die gewonnenen Behandlungen.",
  },
  ltv: {
    term: "Wert pro Patient",
    text: "Wert pro Patient: durchschnittlicher Umsatz pro Patient aus dieser Quelle über die gesamte Behandlungsdauer.",
  },
  roas: {
    term: "Werbeertrag",
    text: "Werbeertrag: wie viel Umsatz je 1 € Werbebudget zurückkommt. 6,7× bedeutet 6,70 € Umsatz pro 1 € Werbebudget.",
  },
};

/**
 * Quellen: Attio's bar chart for a count grouped by category on top (one
 * column per source, each in its own colour, the count above it), Stripe's
 * legend rows below it (colour square, name, figures in fixed columns) and
 * a Gesamt row at the bottom like Stripe's total row.
 *
 * Column and row belong together: hovering either one marks both and dims
 * the other columns, and the column shows a card with every figure of that
 * source. Selecting a row (or its column) opens its economics (Kosten pro
 * Anfrage, Kosten pro Patient, Wert pro Patient, Werbeertrag) beneath it; a
 * source without economics (e.g. Unbekannt) does not open. From lg, where
 * the card sits beside Offene Anfragen, it keeps room for one open row, so
 * opening one never changes the height of either card. The Gesamt row sits
 * at the bottom of the card, level with the "weitere offene Anfragen" link
 * beside it.
 *
 * Row props are intentionally primitives only (strings/numbers): the server
 * parent pre-formats every stat, and passing React nodes from a server-
 * rendering parent costs serialization round-trips that have caused stale
 * hydration in dev. Brand logos are rebuilt here.
 */
export interface BreakdownRow {
  key: string;
  /** Plain-text label, decorated with brand logos via `withBrandLogos`. */
  labelText: string;
  /** Lead count: drives the column height, the share and the row order. */
  value: number;
  /** Column and square colour (a CSS colour). Falls back to `tone`. */
  color?: string;
  /** Unbekannt: a plain "?" before the name, in the slot where the other
   *  sources show their logo. */
  unknown?: boolean;
  tone?: BreakdownTone;
  // Funnel figures, pre-formatted. Null = no value.
  anfragen: string | null;
  termine: string | null;
  gewonnen: string | null;
  // Economics (revealed on expand), pre-formatted. Null = no value.
  budget: string | null;
  cpl: string | null;
  cac: string | null;
  ltv: string | null;
  roas: string | null;
  /** Tone hint for the ROAS cell (good above break-even, warn below). */
  roasTone?: BreakdownTone | null;
}

/** Totals row under the list. */
export interface BreakdownTotals {
  /** Row label, e.g. "Gesamt". */
  label: string;
  budget: string | null;
  anfragen: string | null;
  termine: string | null;
  gewonnen: string | null;
}

/**
 * Figure columns shared by the header, every row and the Gesamt row, so the
 * numbers stand under each other. Where the card is at least 30rem wide:
 * Anfragen, Gewonnen, Werbebudget. Narrower (the phone, and the half-width
 * card beside Offene Anfragen between lg and xl, about 325 px at 1024) only
 * Anfragen keeps a column; the other two move into a line under the source
 * name, so the name keeps its room. The three columns take 300 px on their
 * own, so going by the screen width crushed the names to one letter a line.
 * The root is the container (`[container-type:inline-size]`).
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_4.5rem_1.25rem] items-center gap-x-3 px-2 [@container(min-width:30rem)]:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5.5rem_1.25rem]";

export function BreakdownStackChart({
  rows,
  centerLabel = "Anfragen",
  emptyText = "Keine Daten im Zeitraum.",
  totals,
}: {
  rows: BreakdownRow[];
  centerLabel?: string;
  emptyText?: string;
  totals?: BreakdownTotals;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);

  // Largest first: the biggest source is the first column and the top row.
  const sorted = React.useMemo(
    () => [...rows].sort((a, b) => b.value - a.value),
    [rows]
  );

  // Starts collapsed; clicking a row opens it, clicking it again closes it.
  const [open, setOpen] = React.useState<string | null>(null);
  // The source under the pointer, on its column or its row.
  const [hot, setHot] = React.useState<string | null>(null);

  // Guarded against a stale key after a range switch dropped a source.
  const openKey =
    open != null && sorted.some((r) => r.key === open) ? open : null;
  const hotKey = hot != null && sorted.some((r) => r.key === hot) ? hot : null;

  const toggle = (key: string) =>
    setOpen((cur) => (cur === key ? null : key));

  return (
    <div className="flex min-h-0 flex-1 flex-col [container-type:inline-size]">
      <SourceColumns
        rows={sorted}
        emptyText={emptyText}
        total={total}
        hotKey={hotKey}
        onHot={setHot}
        onPick={(r) => hasEcon(r) && toggle(r.key)}
        ariaLabel={
          sorted.length === 0
            ? emptyText
            : `${centerLabel} nach Quelle: ${sorted
                .map((r) => `${r.labelText} ${r.anfragen ?? r.value}`)
                .join(", ")}`
        }
      />

      {/* The card has one height: this block takes what is left between the
          chart and the Gesamt row. Its header stands still, the rows scroll
          (soft shadow where some are hidden), so more sources or an opened
          row never resize the card. */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <div
          aria-hidden
          className={cn(ROW_GRID, "h-7 shrink-0 border-b border-border text-sm text-fg-secondary")}
        >
          <span />
          <span className="text-right">Anfragen</span>
          <span className="hidden text-right [@container(min-width:30rem)]:block">Gewonnen</span>
          <span className="hidden text-right [@container(min-width:30rem)]:block">Werbebudget</span>
          <span />
        </div>
        <ul className="scroll-shadows min-h-0 flex-1 divide-y divide-border [--scroll-bg:var(--surface-tile)]">
          {sorted.map((r) => {
            const isOpen = openKey === r.key;
            const opens = hasEcon(r);
            const panelId = `breakdown-econ-${r.key}`;
            const phoneLine = [
              r.gewonnen && r.gewonnen !== "0" ? `${r.gewonnen} gewonnen` : null,
              r.budget ? `${r.budget} Werbebudget` : null,
            ].filter(Boolean);
            const cells = (
              <>
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[var(--r-mark)]"
                    style={litStyle(r, SWATCH_EDGE)}
                  />
                  <span className="min-w-0">
                    {/* Never cut: a long name ("Link aus Direktnachricht" in
                        the narrow card between lg and xl) wraps instead. */}
                    <span className="block break-words text-[15px] font-medium leading-5 text-fg-primary">
                      {r.unknown ? (
                        <span className="whitespace-nowrap">
                          <CircleHelp
                            aria-hidden
                            className="mr-1 inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em]"
                          />
                          {r.labelText}
                        </span>
                      ) : (
                        withBrandLogos(r.labelText)
                      )}
                    </span>
                    {phoneLine.length > 0 && (
                      <span className="block text-sm text-fg-secondary tabular-nums [@container(min-width:30rem)]:hidden">
                        {phoneLine.join(" · ")}
                      </span>
                    )}
                  </span>
                </span>
                <Figure label="Anfragen" value={r.anfragen ?? "0"} strong />
                <Figure label="Gewonnen" value={r.gewonnen} className="hidden [@container(min-width:30rem)]:block" />
                <Figure label="Werbebudget" value={r.budget} className="hidden [@container(min-width:30rem)]:block" />
                {opens ? (
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "h-5 w-5 text-fg-secondary transition-transform duration-200",
                      isOpen && "rotate-180"
                    )}
                  />
                ) : (
                  <span aria-hidden />
                )}
              </>
            );
            const rowClass = cn(
              ROW_GRID,
              // Two lines high in a narrow card, one in a wide one: the radius follows (DESIGN.md section 5).
              "min-h-11 w-full rounded-[var(--r-panel)] py-2 text-left transition-colors [@container(min-width:30rem)]:rounded-[var(--r-control)]",
              (hotKey === r.key || isOpen) && "bg-[var(--hover-wash)]"
            );
            return (
              <li
                key={r.key}
                onMouseEnter={() => setHot(r.key)}
                onMouseLeave={() => setHot(null)}
              >
                {opens ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(r.key)}
                    className={rowClass}
                  >
                    {cells}
                  </button>
                ) : (
                  <div className={rowClass}>{cells}</div>
                )}
                {isOpen && <EconGrid row={r} panelId={panelId} />}
              </li>
            );
          })}
        </ul>
      </div>

      {totals && (
        <div
          className={cn(
            ROW_GRID,
            "mt-2 shrink-0 border-t border-border pt-3 text-[15px] font-semibold leading-5 text-fg-primary tabular-nums"
          )}
        >
          <span className="min-w-0">
            {totals.label}
            <span className="block min-h-10 text-sm font-normal text-fg-secondary [@container(min-width:30rem)]:hidden">
              {[
                totals.gewonnen && totals.gewonnen !== "0" ? `${totals.gewonnen} gewonnen` : null,
                totals.budget ? `${totals.budget} Werbebudget` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <Figure label="Anfragen" value={totals.anfragen} strong />
          <Figure label="Gewonnen" value={totals.gewonnen} strong className="hidden [@container(min-width:30rem)]:block" />
          <Figure label="Werbebudget" value={totals.budget} strong className="hidden [@container(min-width:30rem)]:block" />
          <span aria-hidden />
        </div>
      )}
    </div>
  );
}

/** A number in one of the fixed figure columns; empty when there is none. */
function Figure({
  label,
  value,
  strong = false,
  className,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-right text-[15px] leading-5 tabular-nums text-fg-primary",
        strong ? "font-semibold" : "font-normal",
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
 * Attio's bar chart for a count grouped by category: one column per source
 * in its own colour with rounded top corners, the count above it, dashed
 * gridlines behind. Hovering a column marks its row and floats a card with
 * every figure of that source.
 */
function SourceColumns({
  rows,
  total,
  hotKey,
  onHot,
  onPick,
  ariaLabel,
  emptyText,
}: {
  emptyText: string;
  rows: BreakdownRow[];
  total: number;
  hotKey: string | null;
  onHot: (key: string | null) => void;
  onPick: (row: BreakdownRow) => void;
  ariaLabel: string;
}) {
  const scaleMax = niceCeil(Math.max(...rows.map((r) => r.value), 1));
  return (
    // --area: height of a full-scale column. Above it 28 px of room for the
    // count over the tallest column, below it the 2 px base line.
    <div role="img" aria-label={ariaLabel} className="relative [--area:88px]">
      {/* Gridlines: the top of the scale and its middle dashed; the columns
          stand on the base line. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0.5 flex h-[var(--area)] flex-col justify-between"
      >
        <span className="border-t border-dashed border-border" />
        <span className="border-t border-dashed border-border" />
        <span />
      </div>
      <ChartFloor />
      {rows.length === 0 && (
        // No sources in this period: the plot area stays, the sentence sits in
        // the middle of it.
        <p className="absolute inset-x-0 top-0 flex h-[calc(var(--area)+1.75rem)] items-center justify-center px-4 text-center text-[15px] leading-5 text-fg-secondary">
          {emptyText}
        </p>
      )}
      <div
        className="relative flex items-end justify-around gap-3 px-2 pb-0.5"
        style={{ height: "calc(var(--area) + 1.75rem + 2px)" }}
      >
        {rows.map((r, i) => {
          const share = r.value / scaleMax;
          const dim = hotKey != null && hotKey !== r.key;
          const align = i === 0 ? "left" : i === rows.length - 1 ? "right" : "center";
          return (
            <div
              key={r.key}
              onMouseEnter={() => onHot(r.key)}
              onMouseLeave={() => onHot(null)}
              onClick={() => onPick(r)}
              className={cn(
                "relative flex h-full max-w-14 flex-1 flex-col items-center justify-end transition-opacity duration-200",
                hasEcon(r) && "cursor-pointer",
                dim && "opacity-40"
              )}
            >
              <span className="mb-1.5 text-sm font-semibold leading-none tabular-nums text-fg-primary">
                {r.anfragen ?? r.value}
              </span>
              <span
                aria-hidden
                className="anim-bar-y block w-full rounded-t-[var(--r-control)]"
                style={
                  {
                    height: `max(3px, calc(var(--area) * ${share.toFixed(4)}))`,
                    ...litStyle(r, "var(--bar-edge)"),
                    clipPath: COLUMN_CLIP,
                    "--delay": `${i * 40}ms`,
                  } as React.CSSProperties
                }
              />
              {hotKey === r.key && (
                <div
                  className={cn(
                    HOVER_CARD,
                    align === "left" && "left-0",
                    align === "right" && "right-0",
                    align === "center" && "left-1/2 -translate-x-1/2"
                  )}
                >
                  <SourceCard row={r} sharePct={total > 0 ? (r.value / total) * 100 : 0} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Smallest of 1, 2, 2.5, 5 times a power of ten that is at least `n`. */
function niceCeil(n: number): number {
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/** Column and square colour of a source. */
function colorOf(row: BreakdownRow): string {
  return row.color ?? toneVar[row.tone ?? "accent"];
}

const SWATCH_EDGE = "inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 1px rgba(16, 16, 26, 0.18)";

function litStyle(row: BreakdownRow, edge: string): React.CSSProperties {
  return { backgroundColor: colorOf(row), backgroundImage: LIT_FROM_ABOVE, boxShadow: edge };
}

/** Whether a source has any economics to open (budget-less sources do not). */
function hasEcon(row: BreakdownRow): boolean {
  return row.cpl != null || row.cac != null || row.ltv != null || row.roas != null;
}

/**
 * Economics of one source (Kosten pro qualifizierter Anfrage, Kosten pro Patient, Wert pro
 * Patient, Werbeertrag) under its open row: label left, value right, two per
 * line only where both fit whole (13.25rem each, the card is narrow between
 * md and xl), else one. Metrics without a value are left out; invisible cells fill
 * the grid, so it always keeps its height. Without a row it is only those
 * cells: the room the card keeps for an open row.
 */
function EconGrid({ row, panelId }: { row?: BreakdownRow; panelId?: string }) {
  const items = row
    ? [
        row.cpl != null && <EconItem key="cpl" label="Pro qualifizierte Anfrage" value={row.cpl} info={ECON_INFO.cpl} />,
        row.cac != null && <EconItem key="cac" label="Kosten pro Patient" value={row.cac} info={ECON_INFO.cac} />,
        row.ltv != null && <EconItem key="ltv" label="Wert pro Patient" value={row.ltv} info={ECON_INFO.ltv} />,
        row.roas != null && (
          <EconItem
            key="roas"
            label="Werbeertrag"
            value={row.roas}
            tone={row.roasTone ?? "good"}
            info={ECON_INFO.roas}
          />
        ),
      ].filter(Boolean)
    : [];
  return (
    <div
      id={panelId}
      className="elev-inset mx-2 mb-1.5 mt-0.5 grid gap-x-6 gap-y-2 rounded-[var(--r-panel)] bg-[var(--well)] py-2 pl-[1.375rem] pr-7 grid-cols-[repeat(auto-fit,minmax(13.25rem,1fr))]"
    >
      {items}
      {Array.from({ length: ECON_CELLS - items.length }, (_, i) => (
        <div key={`fill-${i}`} aria-hidden className="invisible">
          <EconItem label="–" value="–" />
        </div>
      ))}
    </div>
  );
}

/** Cells in the economics grid: four metrics. */
const ECON_CELLS = 4;

/** One economics metric: label (with explainer) left, value right. */
function EconItem({
  label,
  value,
  tone,
  info,
}: {
  label: string;
  value: string | null;
  tone?: BreakdownTone | null;
  info?: { term: string; text: string };
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 text-sm leading-5">
      <span className="flex min-w-0 items-center gap-0.5 text-fg-primary">
        <span className="truncate">{label}</span>
        {info && (
          <ExplainerPopover term={info.term} className="h-4 w-4">
            {info.text}
          </ExplainerPopover>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 font-semibold tabular-nums",
          tone ? statToneClass[tone] : "text-fg-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The card over a hovered column: the source name, then Anfragen (with the
 * share), Termine and Gewonnen. The money figures live in the open row.
 */
function SourceCard({ row, sharePct }: { row: BreakdownRow; sharePct: number }) {
  const shareStr = `${
    sharePct < 10 ? sharePct.toFixed(1).replace(".", ",") : sharePct.toFixed(0)
  } %`;
  const lines = [
    { label: "Anfragen", value: row.anfragen ?? "0", extra: `${shareStr} aller Anfragen` },
    { label: "Termine", value: row.termine },
    { label: "Gewonnen", value: row.gewonnen },
  ].filter((l): l is { label: string; value: string; extra?: string } => l.value != null);
  return <HoverCardBody title={row.labelText} color={colorOf(row)} lines={lines} />;
}
