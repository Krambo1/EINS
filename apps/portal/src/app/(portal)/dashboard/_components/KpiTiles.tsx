import type { ReactNode } from "react";
import {
  TrendChart,
  cn,
  type TrendChartPoint,
  type TrendChartTone,
  type TrendChartValueFormat,
} from "@eins/ui";
import { CARD_TITLE, RollingNumber, TitleLink } from "./dash-ui";
import { ChartFloor } from "./hover-card";

/** Lines like Triple Whale's tiles: straight segments, 2 px, coloured by
 *  height in EINS mint (tokens in globals.css), with the short hover card. */
const LINE_STYLE = {
  curve: "straight",
  strokeWidth: 2,
  lineGradient: { top: "var(--line-top)", bottom: "var(--line-bottom)" },
  tooltip: "compact",
} as const;

export interface KpiTileProps {
  label: string;
  /** Shorter label for a tile too narrow for `label` at headline size. */
  shortLabel?: string;
  /** Explainer popover next to the label. */
  labelExtra?: ReactNode;
  value: string;
  /** Change against the period before (DeltaText), next to the number. */
  delta?: ReactNode;
  series?: TrendChartPoint[];
  /** Period before; drawn only on the primary number's chart. */
  comparison?: TrendChartPoint[];
  /** Date ticks under the primary chart: "month" once the period spans years. */
  tickFormat?: "day" | "month";
  chartTone?: TrendChartTone;
  chartLabel?: string;
  valueFormat?: TrendChartValueFormat;
  /** The page behind the Kennzahl: the label becomes its link (`TitleLink`). */
  href?: string;
  /** The one number the page is about: own panel, bigger, with a real chart. */
  primary?: boolean;
  /** Fills a whole row of the 2 x 2 block (odd number of cells). */
  wide?: boolean;
  /**
   * Primary tile without a curve to draw (empty period, a single day): the
   * plot area keeps its frame, its dashed gridlines and its base line, and
   * this note sits in the middle of it.
   */
  emptyNote?: ReactNode;
}

/**
 * One Kennzahl. The primary one (Anfragen) fills its own panel with a full
 * chart and the period before, on every screen size. The others are cells of
 * the 2 x 2 block: a row on the phone (label and number left, line right),
 * stacked with a line under the number from md up. Every cell uses the card
 * padding (20 px phone, 24 px from md), so labels line up across panels.
 */
export function KpiTile({
  label,
  shortLabel,
  labelExtra,
  value,
  delta,
  series,
  comparison,
  tickFormat,
  chartTone = "accent",
  chartLabel,
  valueFormat = "number",
  href,
  primary = false,
  wide = false,
  emptyNote,
}: KpiTileProps) {
  const labelText = shortLabel ? (
    <>
      <span className="kpi-label-full">{label}</span>
      <span className="kpi-label-short">{shortLabel}</span>
    </>
  ) : (
    label
  );
  const hasChart = !!series && series.length > 1;
  // A new period is a new chart: keyed by its span, the line draws in again
  // instead of jumping to the new shape.
  const chartKey = hasChart ? `${series!.length}-${series![0]!.date}` : "none";

  return (
    <div
      className={cn(
        "group relative flex min-w-0 bg-[var(--surface-tile)] px-5 md:p-6",
        primary
          ? "flex-1 flex-col py-5"
          : "items-center gap-4 py-4 md:flex-col md:items-stretch md:gap-0",
        wide && "md:col-span-2",
        shortLabel && "kpi-tile"
      )}
    >
      <div className="min-w-0 flex-1 md:flex-none">
        {/* Fixed row height: an info icon must not push this tile's number
            lower than the number in the tile next to it. */}
        <div className="flex h-5 min-w-0 items-center gap-1">
          {/* The label is the tile's headline, the same as every card's, and
              like theirs the link to the page behind it. */}
          <span className={cn(href ? "flex min-w-0" : "truncate", CARD_TITLE)}>
            {href ? <TitleLink href={href}>{labelText}</TitleLink> : labelText}
          </span>
          {labelExtra && <span className="relative z-10 inline-flex">{labelExtra}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <RollingNumber
            value={value}
            className={cn(
              "font-display font-semibold leading-none tracking-tight tabular-nums text-fg-primary",
              primary ? "text-[2.5rem] md:text-[3rem]" : "text-[1.75rem] md:text-[2rem]"
            )}
          />
          {delta}
        </div>
      </div>
      {primary ? (
        // Above the link so the hover tooltip works. The line draws in from the
        // left. The plot area has one fixed height (20 px of room, the 180 px
        // chart, its date ticks), so the tile never changes size: an empty
        // period shows the same frame with its note in the middle.
        <div key={chartKey} className="relative z-10 mt-auto h-[216px] pt-5 [&_span]:whitespace-nowrap">
          {hasChart && !emptyNote ? (
            <div className="anim-wipe">
              <TrendChart
                data={series!}
                comparisonData={comparison}
                tone={chartTone}
                label={chartLabel ?? label}
                valueFormat={valueFormat}
                height={180}
                showAxes
                showYAxis={false}
                tickFormat={tickFormat}
                {...LINE_STYLE}
                comparisonDash="0 4"
              />
            </div>
          ) : (
            <PlotFrame note={emptyNote ?? "Für einen einzelnen Tag gibt es noch keinen Verlauf."} />
          )}
        </div>
      ) : (
        // Fixed box for the line (40 px, 56 px with its top padding from md):
        // without one the box stays and holds a flat line.
        <div
          key={chartKey}
          className="relative z-10 h-10 w-20 shrink-0 md:mt-auto md:h-14 md:w-auto md:pt-4"
        >
          {hasChart ? (
            <div className="anim-wipe">
              <TrendChart
                data={series!}
                tone={chartTone}
                label={chartLabel ?? label}
                valueFormat={valueFormat}
                height={40}
                filled={false}
                {...LINE_STYLE}
              />
            </div>
          ) : (
            <div aria-hidden className="flex h-10 items-end">
              <span className="block h-0.5 w-full rounded-full bg-[var(--border-hover)]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Kennzahlen row: the primary number in its own panel, the others in a 2 x 2
 * block with hairlines between the cells. From xl the two panels sit side by
 * side with the same gap as the cards below, so their edges line up with the
 * next row; below xl a cell would be too narrow for its headline. Both stand on the canvas like every card and come up when hovered;
 * the primary panel is also a link to the Anfragen.
 */
export function KpiGrid({ primary, children }: { primary: ReactNode; children: ReactNode }) {
  return (
    <section aria-label="Kennzahlen" className="grid gap-4 md:gap-6 xl:grid-cols-2">
      <div className="anim-rise elev-card lift flex overflow-hidden rounded-[var(--r-card)]">{primary}</div>
      <div className="anim-rise elev-card lift grid gap-px overflow-hidden rounded-[var(--r-card)] bg-border [--delay:40ms] md:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

/**
 * The plot area of the primary chart without a curve: dashed gridlines at the
 * top and the middle, the 2 px base line, the note centred in between. Same
 * 180 px as the chart, so the tile keeps its size.
 */
function PlotFrame({ note }: { note: ReactNode }) {
  return (
    <div className="relative h-[180px]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 inset-y-0 flex flex-col justify-between">
        <span className="border-t border-dashed border-border" />
        <span className="border-t border-dashed border-border" />
        <span />
      </div>
      <ChartFloor />
      <p className="absolute inset-0 flex flex-wrap content-center items-center justify-center gap-x-1.5 px-6 pb-1 text-center text-[15px] leading-5 text-fg-secondary [&_a]:whitespace-normal">
        {note}
      </p>
    </div>
  );
}
