import type { ReactNode } from "react";
import { cn } from "@eins/ui";
import type { DashboardRange } from "@/lib/dashboard-range";
import { RANGE_HEADER_TEXT } from "./range-text";

/**
 * Active time window of one card, as readable text in the card header. The
 * single page-level switch (DashboardRangeSwitch) sets every card; this label
 * keeps each card honest about which period its numbers cover, also for deep
 * links that still carry different per-card params.
 */
export function CardRangeLabel({
  range,
  className,
}: {
  range: DashboardRange;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-sm font-medium text-fg-primary md:text-base",
        className
      )}
    >
      {RANGE_HEADER_TEXT[range]}
    </span>
  );
}

/**
 * One plain sentence in place of an empty chart. Keeps roughly the chart's
 * height (`minHeight`) so a card doesn't jump when data arrives.
 */
export function CardEmptyNote({
  children,
  minHeight = 120,
  className,
}: {
  children: ReactNode;
  minHeight?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-dashed border-border bg-bg-secondary px-4 py-4",
        className
      )}
      style={{ minHeight }}
    >
      <p className="text-base text-fg-primary">{children}</p>
    </div>
  );
}
