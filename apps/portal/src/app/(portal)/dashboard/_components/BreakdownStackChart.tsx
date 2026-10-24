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
    term: "Kosten pro Anfrage",
    text: "Kosten pro Anfrage: Werbebudget geteilt durch die Zahl der Anfragen aus dieser Quelle.",
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
 * Quellen-Aufschlüsselung — aufklappbare Zeilen.
 *
 * One list row per source (Anfragen, Werbebudget, gewonnen); selecting a row
 * reveals its economics (CPL · CAC · LTV · ROAS) beneath it. The drawer's height is always reserved
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

/** Totals line under the list. */
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
    return <p className="py-4 text-base text-fg-primary">{emptyText}</p>;
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
        <div className="text-sm font-medium text-fg-primary">
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

      {/* One row per source: name left, Anfragen right, budget and outcome
          as a grey line below. Selecting a row opens its economics (2x2 grid)
          beneath it. A list instead of a table, so nothing scrolls sideways
          and no header has to break across lines in a half-width card.
          Meta logo override: the brand lockup defaults to 2em tall; 1.9em
          keeps it in line with the text. */}
      <ul className="divide-y divide-border border-y border-border">
        {sorted.map((r) => {
          const isOpen = openKey === r.key;
          const panelId = `breakdown-econ-${r.key}`;
          const sub = [
            r.budget ? `${r.budget} Werbebudget` : null,
            r.gewonnen && r.gewonnen !== "0" ? `${r.gewonnen} gewonnen` : null,
          ].filter(Boolean);
          return (
            <li key={r.key} className={isOpen ? "bg-bg-secondary" : undefined}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(r.key)}
                className="flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-bg-secondary"
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: toneVar[r.tone ?? "accent"] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-base text-fg-primary">{withBrandLogos(r.labelText)}</span>
                  {sub.length > 0 && (
                    <span className="mt-0.5 block text-sm text-fg-secondary tabular-nums">{sub.join(" · ")}</span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-semibold leading-tight tabular-nums text-fg-primary">
                    {r.anfragen ?? "0"}
                  </span>
                </span>
                {isOpen ? (
                  <ChevronDown className="h-5 w-5 shrink-0 text-fg-secondary" aria-hidden />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-fg-secondary" aria-hidden />
                )}
              </button>
              {isOpen && <EconGrid row={r} panelId={panelId} />}
            </li>
          );
        })}
        {/* Reserve the drawer's height when nothing is expanded, so the card
            stays the same height collapsed as it is with a row open. */}
        {openKey === null && sorted[0] && (
          <li aria-hidden className="invisible">
            <EconGrid row={sorted[0]} />
          </li>
        )}
      </ul>

      {totals && (
        <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-fg-primary tabular-nums">
          <span className="font-semibold">{totals.label}</span>
          <span>
            {[
              totals.anfragen ? `${totals.anfragen} Anfragen` : null,
              totals.budget ? `${totals.budget} Werbebudget` : null,
              totals.gewonnen ? `${totals.gewonnen} gewonnen` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Economics of one source (Kosten pro Anfrage, Kosten pro Patient, Wert pro
 * Patient, Werbeertrag) as a 2x2 grid under its open row. Also rendered
 * invisible as a height-reserving spacer when no row is open, so the card
 * keeps the same height expanded or collapsed.
 */
function EconGrid({ row, panelId }: { row: BreakdownRow; panelId?: string }) {
  return (
    <div id={panelId} className="grid grid-cols-2 gap-x-4 gap-y-3 px-2 pb-4 pt-1 pl-7">
      <EconItem label="Kosten pro Anfrage" value={row.cpl} info={ECON_INFO.cpl} />
      <EconItem label="Kosten pro Patient" value={row.cac} info={ECON_INFO.cac} />
      <EconItem label="Wert pro Patient" value={row.ltv} info={ECON_INFO.ltv} />
      <EconItem label="Werbeertrag" value={row.roas} tone={row.roasTone ?? "good"} info={ECON_INFO.roas} />
    </div>
  );
}

/** One economics metric: label (with explainer) over the value. */
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
  const hasValue = value != null;
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-0.5 text-sm leading-tight text-fg-primary">
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
    </div>
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
        <span className="truncate text-sm font-semibold text-fg-primary">
          {row.labelText}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <HoverRow label="Anteil" value={shareStr} />
        <HoverRow label="Anfragen" value={row.anfragen} />
        <HoverRow label="Termine" value={row.termine} />
        <HoverRow label="Gewonnen" value={row.gewonnen} tone="good" />
        <div className="my-1.5 h-px bg-border" />
        <HoverRow label="Werbebudget" value={row.budget} />
        <HoverRow label="Kosten pro Anfrage" value={row.cpl} />
        <HoverRow label="Kosten pro Patient" value={row.cac} />
        <HoverRow label="Wert pro Patient" value={row.ltv} />
        <HoverRow label="Werbeertrag" value={row.roas} tone={row.roasTone ?? "good"} />
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
      <span className="text-sm text-fg-primary">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums ${
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
