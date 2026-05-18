"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@eins/ui";
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_LABELS,
  type DashboardRange,
} from "@/lib/dashboard-range";

type PillGeom = { left: number; top: number; width: number; height: number };

// Module-level cache of the last-known pill geometry per `paramKey`. The
// toggle lives inside the page's <Suspense> boundary, which re-suspends
// whenever the URL changes (because the page-level `await Promise.all`
// sits above the boundary). That tears the toggle down — without this
// cache, the freshly mounted toggle has no "previous position" and the
// pill would just appear at the new spot with no slide. With it, mount
// renders the pill at the cached position, then useEffect measures the
// new target and triggers a re-render whose style change drives the CSS
// transition. Both keep-mounted and unmount/remount paths animate the
// same way.
const pillGeomCache = new Map<string, PillGeom>();

interface Props {
  /** Active range value. */
  value: DashboardRange;
  /** URL search-param key this toggle writes to (each card has its own). */
  paramKey: string;
  /** Accessible label naming the metric this toggle controls. */
  ariaLabel: string;
}

/**
 * Compact segmented control that drives one card's time window via a
 * dedicated `?paramKey=` search param. URL-driven so deep links + back
 * nav keep the selection, and so the server component upstream re-fetches
 * with the new window. `router.replace` + transition keeps the page from
 * scrolling and preserves the previous render while the new one streams in.
 *
 * Selection is rendered as a sliding pill (mirrors the desktop sidenav) so
 * range changes animate left/right instead of flashing in place. The pill
 * uses `bg-fg-primary`, which is black in light mode and white in dark mode.
 */
export function TimeRangeToggle({ value, paramKey, ariaLabel }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const select = (next: DashboardRange) => {
    if (next === value) return;
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set(paramKey, next);
    const qs = nextParams.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // Sliding pill — measure the active button (and all siblings via
  // ResizeObserver) so the pill follows font-load / locale changes that
  // can resize labels after first paint. Initial state restores from
  // pillGeomCache so a remount after navigation still has an old position
  // to animate from.
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<PillGeom | null>(() => {
    // SSR has no layout to measure and the cache lives in client-only
    // module state. Restoring here means the very first client render
    // after a remount paints at the old position before the effect
    // measures the new one — that style change is what CSS transitions on.
    if (typeof window === "undefined") return null;
    return pillGeomCache.get(paramKey) ?? null;
  });

  useEffect(() => {
    const measureTarget = (): PillGeom | null => {
      const el = itemRefs.current[value];
      if (!el) return null;
      return {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    };

    const target = measureTarget();
    if (!target) return;

    setPill(target);
    pillGeomCache.set(paramKey, target);

    const ro = new ResizeObserver(() => {
      const t = measureTarget();
      if (!t) return;
      setPill(t);
      pillGeomCache.set(paramKey, t);
    });
    Object.values(itemRefs.current).forEach((el) => {
      if (el) ro.observe(el);
    });
    return () => ro.disconnect();
  }, [value, paramKey]);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-full border border-border bg-bg-secondary/60 p-0.5 backdrop-blur-sm transition-opacity sm:p-1",
        isPending && "opacity-70"
      )}
      aria-busy={isPending}
    >
      {pill && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-full bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)] transition-[transform,width,height] duration-300 ease-out will-change-transform"
          style={{
            transform: `translate3d(${pill.left}px, ${pill.top}px, 0)`,
            width: pill.width,
            height: pill.height,
          }}
        />
      )}
      {DASHBOARD_RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            ref={(el) => {
              itemRefs.current[r] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => select(r)}
            className={cn(
              "relative z-10 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium tabular-nums transition-colors duration-300 sm:px-2.5 sm:py-1.5 sm:text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary",
              active
                ? "text-bg-primary"
                : "text-fg-secondary hover:text-fg-primary",
              // SSR / pre-measurement fallback so the active label isn't
              // briefly invisible (light-on-light) before the pill mounts.
              active && !pill && "bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
            )}
          >
            {DASHBOARD_RANGE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}
