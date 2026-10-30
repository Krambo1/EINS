import type { ReactNode } from "react";
import { cn } from "@eins/ui";

/**
 * The facts of an Anfrage in one quiet line under its name ("Botox · Google
 * Ads · 08.10.2026"). It wraps between facts, and a long free-text wish wraps
 * inside itself, so nothing is cut off. Empty facts are skipped.
 */
export function Facts({
  children,
  className,
}: {
  children: ReactNode[];
  className?: string;
}) {
  const parts = children.filter((c) => c != null && c !== false && c !== "");
  return (
    <span
      className={cn(
        "mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm leading-5 text-fg-secondary",
        className
      )}
    >
      {parts.map((p, i) => (
        // The dot stays at the end of a line, never at the start of the next.
        <span key={i} className="min-w-0 break-words">
          {p}
          {i < parts.length - 1 && (
            <span aria-hidden className="ml-1.5">
              ·
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
