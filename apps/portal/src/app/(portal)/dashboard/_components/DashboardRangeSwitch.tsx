"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@eins/ui";
import { RANGE_SWITCH_TEXT } from "./range-text";
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_KEYS,
  parseDashboardRange,
  type DashboardRange,
} from "@/lib/dashboard-range";

/**
 * Every per-card range param the dashboard reads. The page-level switch writes
 * all of them at once, so the cards always show the same period. The params
 * stay per card (one query path, unchanged loaders, old deep links keep
 * working); only the UI that writes them is now a single control.
 */
const DASHBOARD_CARD_KEYS = [
  DASHBOARD_RANGE_KEYS.leads,
  DASHBOARD_RANGE_KEYS.revenue,
  DASHBOARD_RANGE_KEYS.open,
  DASHBOARD_RANGE_KEYS.sources,
  DASHBOARD_RANGE_KEYS.funnel,
  DASHBOARD_RANGE_KEYS.locations,
  DASHBOARD_RANGE_KEYS.treatments,
  DASHBOARD_RANGE_KEYS.noShow,
] as const;

/**
 * One time-range switch for the whole dashboard. Active segment = the range
 * all cards share; when a deep link carries different per-card ranges no
 * segment is active and each card header names its own period.
 */
export function DashboardRangeSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const ranges = DASHBOARD_CARD_KEYS.map((k) =>
    parseDashboardRange(params.get(k) ?? undefined)
  );
  const shared: DashboardRange | null = ranges.every((r) => r === ranges[0])
    ? ranges[0]!
    : null;

  const select = (next: DashboardRange) => {
    if (next === shared) return;
    const nextParams = new URLSearchParams(params.toString());
    for (const key of DASHBOARD_CARD_KEYS) nextParams.set(key, next);
    startTransition(() => {
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id="dashboard-range-label" className="text-base font-medium text-fg-primary">
        Zeitraum für alle Karten
      </span>
      <div
        role="radiogroup"
        aria-labelledby="dashboard-range-label"
        aria-busy={isPending}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border bg-bg-secondary p-1 transition-opacity",
          isPending && "opacity-70"
        )}
      >
        {DASHBOARD_RANGES.map((r) => {
          const active = r === shared;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(r)}
              className={cn(
                "min-h-[44px] whitespace-nowrap rounded-full px-4 text-base font-medium transition-colors md:min-h-0 md:py-1.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary",
                active
                  ? "bg-fg-primary text-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                  : "text-fg-primary hover:bg-bg-tertiary"
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
    <div aria-hidden className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="h-5 w-48 rounded bg-bg-secondary" />
      <div className="h-[46px] w-72 rounded-full bg-bg-secondary md:h-[38px]" />
    </div>
  );
}
