"use client";

import * as React from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { cn } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { withBrandLogos } from "@/app/_components/Brand";
import { WASH_AREA, WASH_ROW } from "./dash-ui";

// Tone vocabulary mirrors `./detail-helpers` but is inlined so this client
// component doesn't drag the server-only helpers file across the boundary.
type BreakdownTone = "neutral" | "muted" | "accent" | "good" | "warn" | "bad";

const statToneClass: Record<BreakdownTone, string> = {
  neutral: "text-fg-primary",
  muted: "text-fg-primary",
  accent: "text-fg-primary",
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
};

/** Concise plain-Deutsch explainers for the non-obvious economics metrics.
 *  The columns (Anfragen · Gewonnen · Werbebudget) are self-explanatory and
 *  intentionally left without a help bubble. */
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
 * Quellen: Stripe's rows (name, figures in fixed columns) and a Gesamt row at the bottom like Stripe's total row.
 *
 * Selecting a row opens its economics (Kosten pro
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
  /** Lead count: drives the row order. */
  value: number;
  /** Unbekannt: a plain "?" before the name, in the slot where the other
   *  sources show their logo. */
  unknown?: boolean;
  // Funnel figures, pre-formatted. Null = no value.
  anfragen: string | null;
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
  "grid grid-cols-[minmax(0,1fr)_4.5rem_1.25rem] items-center gap-x-3 [@container(min-width:30rem)]:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5.5rem_1.25rem]";

/**
 * The logos differ in width (TikTok 13 px, Meta 19 px), so each gets a 20 px
 * slot with the mark centred and every name starts on one line, 24 px in
 * (slot plus the logo's 4 px margin). `NAME_INDENT` puts Gesamt and the line
 * under a name on that same line; the name itself hangs its logo into it.
 */
const LOGO_SLOT = "[&_img]:w-5 [&_img]:object-contain [&_svg]:w-5";
const NAME_INDENT = "pl-6";

export function SourceBreakdown({
  rows,
  emptyText = "Keine Daten im Zeitraum.",
  totals,
}: {
  rows: BreakdownRow[];
  emptyText?: string;
  totals?: BreakdownTotals;
}) {
  // Largest first: the biggest source is the top row.
  const sorted = React.useMemo(
    () => [...rows].sort((a, b) => b.value - a.value),
    [rows]
  );

  // Starts collapsed; clicking a row opens it, clicking it again closes it.
  const [open, setOpen] = React.useState<string | null>(null);

  // Guarded against a stale key after a range switch dropped a source.
  const openKey =
    open != null && sorted.some((r) => r.key === open) ? open : null;

  const toggle = (key: string) =>
    setOpen((cur) => (cur === key ? null : key));

  return (
    <div className="flex min-h-0 flex-1 flex-col [container-type:inline-size]">
      {/* The card has one height: this block takes what is left above the
          Gesamt row. Its header stands still, the rows scroll (soft shadow
          where some are hidden), so more sources or an opened row never
          resize the card. */}
      <div className="flex min-h-0 flex-1 flex-col">
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
        {sorted.length === 0 ? (
          // No sources in this period: the sentence sits in the rows' space.
          <p className="flex flex-1 items-center justify-center px-4 text-center text-[15px] leading-5 text-fg-secondary">
            {emptyText}
          </p>
        ) : (
        // -mx-3 px-3: the scroll box must not clip the rows' grey, which
        // reaches 12 px past the content (WASH_AREA).
        <ul className="scroll-shadows -mx-3 min-h-0 flex-1 divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)]">
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
                <span className="min-w-0">
                  {/* Never cut: a long name ("Link aus Direktnachricht" in
                      the narrow card between lg and xl) wraps instead. */}
                  <span
                    className={cn(
                      "block break-words text-[15px] font-medium leading-5 text-fg-primary -indent-6",
                      NAME_INDENT,
                      LOGO_SLOT
                    )}
                  >
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
                    <span className={cn("block text-sm text-fg-secondary tabular-nums [@container(min-width:30rem)]:hidden", NAME_INDENT)}>
                      {phoneLine.join(" · ")}
                    </span>
                  )}
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
            // Two lines in a narrow card (the line under the name), one in a
            // wide one: 12 px above and below two lines, 8 px around one, and
            // the radius follows the height (DESIGN.md section 5). The room
            // above stays the same when the row opens, so its text never moves.
            const twoLine = phoneLine.length > 0;
            const rowClass = cn(
              ROW_GRID,
              "-mx-3 min-h-9 w-[calc(100%+1.5rem)] rounded-[var(--r-control)] px-3 text-left",
              twoLine ? "pt-3 [@container(min-width:30rem)]:pt-2" : "pt-2",
              isOpen || !twoLine ? "pb-2" : "pb-3 [@container(min-width:30rem)]:pb-2"
            );
            return (
              <li key={r.key} className={WASH_ROW}>
                <div
                  className={cn(
                    WASH_AREA,
                    "transition-colors",
                    isOpen
                      ? "rounded-[var(--r-panel)] bg-[var(--hover-wash)] pb-3"
                      : cn(
                          "hover:bg-[var(--hover-wash)]",
                          twoLine
                            ? "rounded-[var(--r-panel)] [@container(min-width:30rem)]:rounded-[var(--r-control)]"
                            : "rounded-[var(--r-control)]"
                        )
                  )}
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
                </div>
              </li>
            );
          })}
        </ul>
        )}
      </div>

      {totals && (
        <div
          className={cn(
            ROW_GRID,
            "mt-2 shrink-0 border-t border-border pt-3 text-[15px] font-semibold leading-5 text-fg-primary tabular-nums"
          )}
        >
          <span className={cn("min-w-0", NAME_INDENT)}>
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
      className="elev-inset grid gap-x-6 gap-y-2 rounded-[var(--r-panel)] bg-[var(--well)] py-3 pl-6 pr-7 grid-cols-[repeat(auto-fit,minmax(13.25rem,1fr))]"
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
