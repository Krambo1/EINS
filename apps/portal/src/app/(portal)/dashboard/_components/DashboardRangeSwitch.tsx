"use client";

import { cn } from "@eins/ui";
import { RANGE_SWITCH_TEXT } from "./range-text";
import { DASHBOARD_RANGES } from "@/lib/dashboard-range";
import { useDashboardRange } from "./RangeViews";

/**
 * One time-range switch for the whole dashboard. The marked segment is the
 * period all cards share (none when a deep link mixes them). Picking a period
 * moves the marker at once; the cards follow from the client cache in
 * RangeViews, so there is no page round-trip.
 *
 * Layers: the track is pressed into the canvas, the marker is a raised chip
 * that slides to the picked segment. Segments are equal width, so the marker
 * only needs the index.
 */
export function DashboardRangeSwitch() {
  const { picked, loading, select } = useDashboardRange();
  const index = picked ? DASHBOARD_RANGES.indexOf(picked) : -1;

  // Phone: full-width segmented control that sticks under the header, so the
  // period is always in view while scrolling (Triple Whale's date bar).
  return (
    // -my-2 cancels the sticky band's py-2 in the layout, so the gap to the
    // blocks above and below stays one spacing step like everywhere else.
    <div className="sticky top-14 z-30 -mx-4 -my-2 flex items-center gap-3 bg-[color-mix(in_srgb,var(--surface-canvas)_82%,transparent)] px-4 py-2 backdrop-blur-md md:static md:m-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      {/* Label for screen readers only: the four periods explain themselves. */}
      <span id="dashboard-range-label" className="sr-only">
        Zeitraum für alle Karten
      </span>
      <div
        role="radiogroup"
        aria-labelledby="dashboard-range-label"
        aria-busy={loading}
        className="elev-inset relative grid h-[var(--track-h)] w-full grid-cols-4 gap-1 rounded-[var(--r-panel)] bg-[var(--surface-inset)] p-1 md:inline-grid md:w-auto"
      >
        {/* Marker: one segment wide (track minus padding and the three gaps,
            divided by four), moved by whole segments plus a gap. */}
        <span
          aria-hidden
          className={cn(
            "elev-raised pointer-events-none absolute bottom-1 left-1 top-1 w-[calc((100%-1.25rem)/4)] rounded-[var(--r-control)] bg-[var(--surface-raised)] transition-[transform,opacity] duration-300 ease-expo",
            index < 0 && "opacity-0"
          )}
          style={{ transform: `translateX(calc(${Math.max(index, 0)} * (100% + 0.25rem)))` }}
        />
        {DASHBOARD_RANGES.map((r) => {
          const active = r === picked;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(r)}
              className={cn(
                "relative whitespace-nowrap rounded-[var(--r-control)] px-2 text-[15px] font-medium transition-colors duration-300 md:px-2.5 lg:px-3.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active ? "text-fg-primary" : "text-fg-secondary hover:text-fg-primary"
              )}
            >
              {RANGE_SWITCH_TEXT[r]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Same footprint as the switch, shown until searchParams are available. */
export function DashboardRangeSwitchSkeleton() {
  return (
    <div aria-hidden className="-my-2 py-2 md:my-0 md:py-0">
      <div className="elev-inset h-[var(--track-h)] w-full rounded-[var(--r-panel)] bg-[var(--surface-inset)] md:w-80" />
    </div>
  );
}
