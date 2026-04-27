"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";
import { cn } from "../lib/cn";

export interface ExplainerPopoverProps {
  /** The short term/abbreviation the user might not know */
  term?: string;
  /** Plain-Deutsch explanation, one to three sentences max. */
  children: React.ReactNode;
  /** Override trigger icon placement */
  className?: string;
  /** Override aria-label for the trigger */
  ariaLabel?: string;
}

/**
 * ExplainerPopover — Opa-proof (i) help bubble.
 *
 * Usage:
 *   <>ROAS <ExplainerPopover term="ROAS">Für jeden Euro Werbeausgabe kommen 2,50 € zurück.</ExplainerPopover></>
 */
export function ExplainerPopover({
  term,
  children,
  className,
  ariaLabel,
}: ExplainerPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={ariaLabel ?? (term ? `Erklärung für ${term}` : "Erklärung")}
        className={cn(
          "opa-focus-ring inline-grid h-7 w-7 place-items-center rounded-full text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
          className
        )}
      >
        <Info className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="text-base leading-relaxed">
        {term && (
          <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-accent">
            {term}
          </p>
        )}
        <div>{children}</div>
      </PopoverContent>
    </Popover>
  );
}
