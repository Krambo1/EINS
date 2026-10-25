import type { ReactNode } from "react";
import { cn } from "@eins/ui";

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
