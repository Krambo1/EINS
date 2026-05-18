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
  /**
   * Visual size of the trigger button. `sm` (default) hugs admin-density
   * labels; `md` matches the bigger Opa-proof SimpleMetric labels.
   */
  size?: "sm" | "md";
}

/**
 * ExplainerPopover — Opa-proof (i) help bubble.
 *
 * Opens on hover (and focus) as well as click — hover gives mouse users
 * instant feedback, click keeps it tappable on touch / keyboard.
 *
 * Usage:
 *   <>ROAS <ExplainerPopover term="ROAS">Für jeden Euro Werbeausgabe kommen 2,50 € zurück.</ExplainerPopover></>
 */
export function ExplainerPopover({
  term,
  children,
  className,
  ariaLabel,
  size = "sm",
}: ExplainerPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  React.useEffect(() => cancelClose, [cancelClose]);

  const sizeClass =
    size === "md" ? "h-8 w-8" : "h-6 w-6";
  const iconClass = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel ?? (term ? `Erklärung für ${term}` : "Erklärung")}
        className={cn(
          "opa-focus-ring inline-grid shrink-0 place-items-center rounded-full text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
          sizeClass,
          className
        )}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={scheduleClose}
      >
        <Info className={iconClass} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="text-base leading-relaxed"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
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
