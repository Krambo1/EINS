"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ExplainerPopover } from "@eins/ui";
import { withBrandLogos } from "@/app/_components/Brand";
import { SegmentedShareBar } from "@/app/_components/SegmentedShareBar";

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

/** Concise plain-Deutsch explainers for the non-obvious economics metrics.
 *  The funnel columns (Anteil · Anfragen · Termine · Gewonnen) are self-
 *  explanatory and intentionally left without a help bubble. */
const ECON_INFO: Record<string, { term: string; text: string }> = {
  cpl: {
    term: "CPL",
    text: "Kosten pro Anfrage: Werbebudget geteilt durch die Zahl der Anfragen aus dieser Quelle.",
  },
  cac: {
    term: "CAC",
    text: "Kosten pro gewonnenem Patienten: Werbebudget geteilt durch die gewonnenen Behandlungen.",
  },
  ltv: {
    term: "LTV",
    text: "Lebenszeitwert: durchschnittlicher Umsatz pro Patient aus dieser Quelle über die gesamte Behandlungsdauer.",
  },
  roas: {
    term: "ROAS",
    text: "Werbeertrag: wie viel Umsatz je 1 € Werbebudget zurückkommt. 6,7× bedeutet 6,70 € Umsatz pro 1 € Budget.",
  },
};

/**
 * Quellen-Aufschlüsselung — aufklappbare Zeilen.
 *
 * The funnel (Anteil · Anfragen · Termine · Gewonnen) stays visible in a dense
 * hairline table; selecting a source row reveals its economics (Budget · CPL ·
 * CAC · LTV · ROAS) inline beneath it. The drawer's height is always reserved
 * (an invisible spacer stands in when nothing is open), so the card keeps a
 * fixed height whether a row is expanded or not — expanding, collapsing, or
 * switching rows never resizes it. Above the table sit the big period total
 * and a segmented share bar; hovering a bar segment shows a floating per-source
 * card with the full metric set.
 *
 * Row props are intentionally primitives only (strings/numbers): the server
 * parent pre-formats every stat, and passing React nodes from a server-
 * rendering parent costs serialization round-trips that have caused stale
 * hydration in dev. Brand logos and tone colours are rebuilt here.
 */
export interface BreakdownRow {
  key: string;
  /** Plain-text label, decorated with brand logos via `withBrandLogos`. */
  labelText: string;
  /** Lead count — drives the share %, the share-bar width, and row order. */
  value: number;
  /** Dot + share-bar segment colour. */
  tone?: BreakdownTone;
  // Funnel columns (always visible), pre-formatted. Null renders as "–".
  anfragen: string | null;
  termine: string | null;
  gewonnen: string | null;
  // Economics (revealed on expand), pre-formatted. Null renders as "–".
  budget: string | null;
  cpl: string | null;
  cac: string | null;
  ltv: string | null;
  roas: string | null;
  /** Tone hint for the ROAS cell (good above break-even, warn below). */
  roasTone?: BreakdownTone | null;
}

/** Totals row pinned to the bottom of the table. Not expandable. */
export interface BreakdownTotals {
  /** Row label, e.g. "Gesamt". */
  label: string;
  /** Σ budget — the top-level column that replaced Anteil. */
  budget: string | null;
  anfragen: string | null;
  termine: string | null;
  gewonnen: string | null;
}

export function BreakdownStackChart({
  rows,
  centerLabel = "Anfragen",
  emptyText = "Keine Daten im Zeitraum.",
  totals,
  defaultOpenKey,
}: {
  rows: BreakdownRow[];
  centerLabel?: string;
  emptyText?: string;
  totals?: BreakdownTotals;
  /** Source opened on first paint. Defaults to the largest (top) row. */
  defaultOpenKey?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);

  // Sort largest first so the dominant source anchors at the left edge of the
  // share bar and the top of the table — bar and rows stay in lock-step.
  const sorted = React.useMemo(
    () => [...rows].sort((a, b) => b.value - a.value),
    [rows]
  );

  // Starts expanded on the top row; clicking the open row collapses it.
  const [open, setOpen] = React.useState<string | null>(
    () => defaultOpenKey ?? sorted[0]?.key ?? null
  );

  // Key → full row lookup so the share bar's hover card (rendered from a
  // primitive ShareSegment) can recover the rich economics for that source.
  const rowByKey = React.useMemo(
    () => new Map(sorted.map((r) => [r.key, r] as const)),
    [sorted]
  );

  // No channels at all (not even placeholders) — nothing to lay out.
  if (sorted.length === 0) {
    return <p className="py-4 text-sm text-fg-secondary">{emptyText}</p>;
  }

  // The actually-open key, guarded against a stale value after a range switch
  // dropped a source. `null` = collapsed; the reserved spacer then holds the
  // drawer's height so the card never changes size.
  const openKey =
    open != null && sorted.some((r) => r.key === open) ? open : null;

  const toggle = (key: string) =>
    setOpen((cur) => (cur === key ? null : key));

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-medium text-fg-secondary">
          {centerLabel}
        </div>
        <div className="mt-1 font-display text-[2.75rem] font-semibold leading-none tabular-nums text-fg-primary md:text-[3.25rem]">
          {total.toLocaleString("de-DE")}
        </div>
      </div>

      {/* Segmented share bar — the shared SegmentedShareBar primitive (also
          used on the admin Übersicht). Hovering a segment floats the rich
          per-source economics card supplied via `renderHover`. */}
      <SegmentedShareBar
        segments={sorted.map((r) => ({
          key: r.key,
          label: r.labelText,
          value: r.value,
          tone: r.tone,
        }))}
        ariaLabel={`${centerLabel}: ${total.toLocaleString("de-DE")}`}
        renderHover={(seg, sharePct) => {
          const row = rowByKey.get(seg.key);
          return row ? (
            <BreakdownHoverBody row={row} sharePct={sharePct} />
          ) : null;
        }}
      />

      {/* Meta logo override: the brand lockup defaults to 2em tall (wide
          wordmark + Instagram glyph). Render it at 1.9em here so it reads as
          the dominant source brand, centred on its row. */}
      <table className="w-full border-collapse text-sm [&_.brand-meta-light]:!h-[1.9em] [&_.brand-meta-light]:!align-middle [&_.brand-meta-light]:!my-[-0.5em] [&_.brand-meta-dark]:!h-[1.9em] [&_.brand-meta-dark]:!align-middle [&_.brand-meta-dark]:!my-[-0.5em]">
        <thead>
          <tr className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
            <th className="py-2 text-left font-medium">
              <span className="sr-only">Quelle</span>
            </th>
            <th className="py-2 pl-2 text-right font-medium">Budget</th>
            <th className="py-2 pl-2 text-right font-medium">Anfragen</th>
            <th className="py-2 pl-2 text-right font-medium">Termine</th>
            <th className="py-2 pl-2 text-right font-medium">Gewonnen</th>
            <th className="w-9 py-2" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isOpen = openKey === r.key;
            const panelId = `breakdown-econ-${r.key}`;
            return (
              <React.Fragment key={r.key}>
                <tr
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(r.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(r.key);
                    }
                  }}
                  className={`group cursor-pointer border-t border-border align-middle transition-colors hover:bg-bg-secondary ${
                    isOpen ? "bg-bg-secondary" : ""
                  }`}
                >
                  <td className="py-2.5 pr-2">
                    <span className="inline-flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: toneVar[r.tone ?? "accent"] }}
                      />
                      <span className="text-fg-primary">
                        {withBrandLogos(r.labelText)}
                      </span>
                    </span>
                  </td>
                  <Cell value={r.budget} />
                  <Cell value={r.anfragen} />
                  <Cell value={r.termine} />
                  <Cell value={r.gewonnen} tone="good" bold />
                  <td className="w-9 py-2.5 pl-1.5 text-right">
                    {/* Pill toggle so every row reads as expandable at rest:
                        a mint chevron in a tertiary chip, which fills with the
                        accent on row-hover and while open. Icon-swap rather
                        than CSS-rotate: a transform on this in-table element
                        resolves to `none` in this subtree, so we switch glyphs
                        to signal open (▾) vs collapsed (▸). */}
                    <span
                      aria-hidden
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-bg-tertiary text-accent ring-accent ring-inset transition-shadow ${
                        isOpen ? "ring-1" : "group-hover:ring-1"
                      }`}
                    >
                      {isOpen ? (
                        <ChevronDown
                          className="h-[18px] w-[18px]"
                          strokeWidth={2.5}
                        />
                      ) : (
                        <ChevronRight
                          className="h-[18px] w-[18px]"
                          strokeWidth={2.5}
                        />
                      )}
                    </span>
                  </td>
                </tr>
                {isOpen && <EconRow row={r} panelId={panelId} />}
              </React.Fragment>
            );
          })}
          {/* Reserve the drawer's height when nothing is expanded, so the card
              stays the same height collapsed as it is with a row open. */}
          {openKey === null && sorted[0] && (
            <EconRow row={sorted[0]} hidden />
          )}
          {totals && (
            <tr className="border-t-2 border-border align-middle font-semibold">
              <td className="py-3 pr-2 text-fg-primary">{totals.label}</td>
              <Cell value={totals.budget} bold />
              <Cell value={totals.anfragen} bold />
              <Cell value={totals.termine} bold />
              <Cell value={totals.gewonnen} tone="good" bold />
              <td className="w-9 py-3" aria-hidden />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The economics drawer row (CPL · CAC · LTV · ROAS). Rendered visible beneath an
 * open source row, or `hidden` (visibility-collapsed) as a height-reserving
 * spacer when no row is open — both render identical markup so the card height
 * is the same expanded or collapsed. (Budget is a top-level column; Anteil is
 * shown only in the hover card, not here.)
 *
 * The four metrics are laid out as real table cells in the Budget · Anfragen ·
 * Termine · Gewonnen columns (not a free grid), so each economics value lines
 * up right-aligned and tabular directly beneath the funnel number above it. A
 * faint caption fills the otherwise-empty Quelle column so the drawer reads as
 * a labelled sub-section rather than four floating numbers. It shares the open
 * row's `bg-bg-secondary` so the row and its drawer form one highlighted block.
 */
function EconRow({
  row,
  panelId,
  hidden,
}: {
  row: BreakdownRow;
  panelId?: string;
  hidden?: boolean;
}) {
  return (
    <tr
      id={hidden ? undefined : panelId}
      className={hidden ? "invisible" : "bg-bg-secondary"}
      aria-hidden={hidden || undefined}
    >
      <td className="pb-3 pt-1 pr-2 align-bottom">
        <span className="text-xs text-fg-tertiary">Wirtschaftlichkeit</span>
      </td>
      <EconCell label="CPL" value={row.cpl} info={ECON_INFO.cpl} />
      <EconCell label="CAC" value={row.cac} info={ECON_INFO.cac} />
      <EconCell label="LTV" value={row.ltv} info={ECON_INFO.ltv} />
      <EconCell
        label="ROAS"
        value={row.roas}
        tone={row.roasTone ?? "good"}
        info={ECON_INFO.roas}
      />
      <td className="w-9 pb-3 pt-1" aria-hidden />
    </tr>
  );
}

/** Right-aligned funnel cell. */
function Cell({
  value,
  tone,
  bold,
}: {
  value: string | null;
  tone?: BreakdownTone;
  bold?: boolean;
}) {
  return (
    <td
      className={`py-2.5 pl-2 text-right tabular-nums ${
        tone ? statToneClass[tone] : "text-fg-primary"
      } ${bold ? "font-semibold" : ""}`}
    >
      {value ?? <span className="text-fg-tertiary">–</span>}
    </td>
  );
}

/** One economics metric as a right-aligned table cell, so its value sits in the
 *  same column (and on the same right edge) as the funnel number above it:
 *  micro-label (with an optional (i) explainer for the non-obvious acronyms)
 *  over a value. */
function EconCell({
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
  const hasValue = value != null;
  return (
    <td className="pb-3 pt-1 pl-2 align-bottom text-right">
      <span className="flex items-center justify-end gap-0.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
        {info && (
          <ExplainerPopover term={info.term} className="h-4 w-4">
            {info.text}
          </ExplainerPopover>
        )}
      </span>
      <span
        className={`mt-0.5 block font-display text-sm font-semibold tabular-nums ${
          !hasValue
            ? "text-fg-tertiary"
            : tone
              ? statToneClass[tone]
              : "text-fg-primary"
        }`}
      >
        {hasValue ? value : "–"}
      </span>
    </td>
  );
}

/**
 * Body of the floating per-source card shown while hovering a share-bar
 * segment, supplied to SegmentedShareBar via `renderHover`. The bar primitive
 * owns the positioned, bordered shell; this fills it with the full per-source
 * metric set so the bar alone tells the whole story.
 */
function BreakdownHoverBody({
  row,
  sharePct,
}: {
  row: BreakdownRow;
  sharePct: number;
}) {
  const color = toneVar[row.tone ?? "accent"];
  const shareStr = `${
    sharePct < 10 ? sharePct.toFixed(1).replace(".", ",") : sharePct.toFixed(0)
  } %`;

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="truncate text-xs font-semibold text-fg-primary">
          {row.labelText}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <HoverRow label="Anteil" value={shareStr} />
        <HoverRow label="Anfragen" value={row.anfragen} />
        <HoverRow label="Termine" value={row.termine} />
        <HoverRow label="Gewonnen" value={row.gewonnen} tone="good" />
        <div className="my-1.5 h-px bg-border" />
        <HoverRow label="Budget" value={row.budget} />
        <HoverRow label="CPL" value={row.cpl} />
        <HoverRow label="CAC" value={row.cac} />
        <HoverRow label="LTV" value={row.ltv} />
        <HoverRow label="ROAS" value={row.roas} tone={row.roasTone ?? "good"} />
      </div>
    </>
  );
}

function HoverRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: BreakdownTone | null;
}) {
  const hasValue = value != null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-fg-secondary">{label}</span>
      <span
        className={`text-xs font-semibold tabular-nums ${
          !hasValue
            ? "text-fg-tertiary"
            : tone
              ? statToneClass[tone]
              : "text-fg-primary"
        }`}
      >
        {hasValue ? value : "–"}
      </span>
    </div>
  );
}
