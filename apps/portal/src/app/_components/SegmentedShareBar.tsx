"use client";

import * as React from "react";
import { formatEuro, formatNumber } from "@/lib/formatting";
import { SHARE_TONE_VAR, type ShareTone } from "@/lib/share-tone";

export type { ShareTone };

const statToneClass: Record<ShareTone, string> = {
  neutral: "text-fg-primary",
  accent: "text-fg-primary",
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
};

/** Serializable value-format hint. Kept a string (not a function) so server
 *  components can pass it across the RSC boundary to this client component. */
export type ShareValueFormat = "number" | "euro";

function formatShareValue(value: number, fmt: ShareValueFormat): string {
  return fmt === "euro" ? formatEuro(value) : formatNumber(value);
}

export interface ShareSegment {
  key: string;
  /** Plain-text label shown in the hover card + the native title tooltip. */
  label: string;
  /** Drives the segment width (flex-grow) and its share of the total. */
  value: number;
  tone?: ShareTone;
}

const CARD_WIDTH = 212;
const CARD_GAP = 10;

/**
 * The rounded, gapped segmented share bar lifted out of the clinic dashboard's
 * Quellen-Aufschlüsselung so the admin Übersicht renders the identical visual.
 * Outer ends of the whole bar are fully rounded; the inner edges where segments
 * meet keep a gentle radius. Hovering a segment dims the rest and floats a
 * per-segment card above the bar, clamped to the bar bounds. When the period
 * has no data the segments render as equal-width outlines.
 *
 * The floating card body is `renderHover`-able: a client caller with richer
 * per-segment metrics (the clinic's Quellen-Aufschlüsselung) supplies its own
 * card body, while everyone else gets the default label · Anteil · value card.
 * Note `renderHover` is a function and can only be passed by a client component;
 * server callers use the default card and the serializable `valueFormat` hint.
 */
export function SegmentedShareBar({
  segments,
  ariaLabel,
  valueFormat = "number",
  valueLabel = "Anzahl",
  renderHover,
}: {
  segments: ShareSegment[];
  ariaLabel?: string;
  /** How to format values in the title tooltip + default hover card. */
  valueFormat?: ShareValueFormat;
  /** Label for the value row in the default hover card (e.g. "Budget"). */
  valueLabel?: string;
  /** Custom hover-card body; receives the hovered segment and its share %.
   *  Client-only (functions cannot cross the server→client boundary). */
  renderHover?: (segment: ShareSegment, sharePct: number) => React.ReactNode;
}) {
  const total = segments.reduce((s, r) => s + r.value, 0);
  const [hover, setHover] = React.useState<{ idx: number; x: number } | null>(
    null
  );
  const barRef = React.useRef<HTMLDivElement | null>(null);

  const updateHover = (idx: number, e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ idx, x: e.clientX - rect.left });
  };

  const active = hover != null ? segments[hover.idx] : null;

  // No segments or zero total → equal-width outline so the slot never goes
  // blank. A single neutral outline stands in when there are no segments at all.
  const list: ShareSegment[] =
    segments.length > 0
      ? segments
      : [{ key: "__empty", label: "", value: 0, tone: "neutral" }];
  const isEmpty = total === 0;

  return (
    <div
      ref={barRef}
      className="relative flex h-8 w-full gap-[3px]"
      role="img"
      aria-label={ariaLabel}
    >
      {list.map((r, i) => {
        const isActive = hover?.idx === i;
        const isFirst = i === 0;
        const isLast = i === list.length - 1;
        const seg = SHARE_TONE_VAR[r.tone ?? "accent"];
        // Outer ends of the whole bar are fully rounded; inner edges where
        // segments meet get a gentle radius. OUTER must be the real pill radius
        // (= half the 32px bar height), NOT a huge sentinel like 999: a 999
        // corner makes CSS's border-radius scaling shrink the other corners on
        // that segment to ~0, which is why the first/last segment's inner edge
        // would render square while the middle ones stayed rounded.
        const INNER = 6;
        const OUTER = 16;
        return (
          <div
            key={r.key}
            className="h-full min-w-[6px] cursor-default transition-opacity"
            style={{
              flexGrow: isEmpty ? 1 : r.value,
              flexBasis: 0,
              backgroundColor: isEmpty ? "transparent" : seg,
              border: isEmpty ? `1.5px solid ${seg}` : undefined,
              opacity: hover && !isActive ? 0.45 : 1,
              borderTopLeftRadius: isFirst ? OUTER : INNER,
              borderBottomLeftRadius: isFirst ? OUTER : INNER,
              borderTopRightRadius: isLast ? OUTER : INNER,
              borderBottomRightRadius: isLast ? OUTER : INNER,
            }}
            onMouseEnter={isEmpty ? undefined : (e) => updateHover(i, e)}
            onMouseMove={isEmpty ? undefined : (e) => updateHover(i, e)}
            onMouseLeave={isEmpty ? undefined : () => setHover(null)}
            title={
              isEmpty
                ? undefined
                : `${r.label}: ${formatShareValue(r.value, valueFormat)}`
            }
          />
        );
      })}

      {!isEmpty && active && hover && (
        <ShareHoverCard
          x={hover.x}
          containerWidth={barRef.current?.clientWidth ?? 0}
        >
          {renderHover ? (
            renderHover(active, (active.value / total) * 100)
          ) : (
            <DefaultHoverBody
              segment={active}
              sharePct={(active.value / total) * 100}
              valueFormat={valueFormat}
              valueLabel={valueLabel}
            />
          )}
        </ShareHoverCard>
      )}
    </div>
  );
}

/**
 * Floating card shown while hovering a share-bar segment. Sits above the bar
 * (translated up by its own height) and follows the cursor's x, clamped to the
 * bar bounds, so it never bleeds past the card edge. Body is supplied by the
 * caller (default or custom).
 */
function ShareHoverCard({
  x,
  containerWidth,
  children,
}: {
  x: number;
  containerWidth: number;
  children: React.ReactNode;
}) {
  const left = Math.max(
    0,
    Math.min(x - CARD_WIDTH / 2, containerWidth - CARD_WIDTH)
  );
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-50 -translate-y-full rounded-lg border border-border bg-bg-primary px-3 py-2.5 text-left shadow-xl"
      style={{ left, top: -CARD_GAP, width: CARD_WIDTH }}
    >
      {children}
    </div>
  );
}

function DefaultHoverBody({
  segment,
  sharePct,
  valueFormat,
  valueLabel,
}: {
  segment: ShareSegment;
  sharePct: number;
  valueFormat: ShareValueFormat;
  valueLabel: string;
}) {
  const color = SHARE_TONE_VAR[segment.tone ?? "accent"];
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
          {segment.label}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <ShareHoverRow label="Anteil" value={shareStr} />
        <ShareHoverRow
          label={valueLabel}
          value={formatShareValue(segment.value, valueFormat)}
        />
      </div>
    </>
  );
}

/** One label/value line inside a hover card. Exported so a custom `renderHover`
 *  body (the clinic's rich card) reuses the exact same row styling. */
export function ShareHoverRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: ShareTone | null;
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
