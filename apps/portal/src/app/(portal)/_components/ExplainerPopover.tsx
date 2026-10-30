"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@eins/ui";

/**
 * The (i) explainer of the Praxis side. Same behaviour as `ExplainerPopover`
 * in `@eins/ui` (opens on hover, focus and tap), dressed in the portal's
 * layers (DESIGN.md §5) and copied from Attio's hover card: a white card with
 * a hairline ring and a soft drop, the term in bold, then the explanation in
 * dark text. The shared one stays as it is for admin (`SimpleMetric`).
 */
export function ExplainerPopover({
  term,
  children,
  className,
  ariaLabel,
}: {
  /** The term the card explains; its title. */
  term?: string;
  /** Plain-German explanation, one to three short paragraphs. */
  children: React.ReactNode;
  /** Extra classes for the (i) trigger. */
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Radix derives `aria-controls` from `useId()`, which drifts between server
  // and client inside a streamed Suspense boundary. A static (i) until mount
  // gives hydration nothing to mismatch; the popover attaches one tick later.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
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

  // Closed: a quiet icon that gets the row wash on hover. Open: raised, like
  // everything that is on right now (layer 3), so it reads as the card's anchor.
  // Shadows as `[box-shadow:…]`: `shadow-[var(--…)]` compiles to a shadow colour.
  const triggerClassName = cn(
    "opa-focus-ring inline-grid h-6 w-6 shrink-0 place-items-center rounded-[var(--r-small)] text-fg-secondary transition-[background-color,box-shadow,color] duration-150 [@media(hover:hover)]:hover:bg-[var(--hover-wash)] [@media(hover:hover)]:hover:text-fg-primary",
    "data-[state=open]:bg-[var(--surface-raised)] data-[state=open]:text-fg-primary data-[state=open]:[box-shadow:var(--elev-raised)]",
    className
  );
  const triggerAriaLabel = ariaLabel ?? (term ? `Erklärung für ${term}` : "Erklärung");

  if (!mounted) {
    return (
      <button type="button" aria-label={triggerAriaLabel} className={triggerClassName}>
        <Info className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={triggerAriaLabel}
        className={triggerClassName}
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
        // A tap fires focus (opens) and then click, whose toggle would shut it
        // again at once: the card never showed on the phone. A click only
        // opens; a tap outside, Escape or leaving closes.
        onClick={(event) => {
          event.preventDefault();
          cancelClose();
          setOpen(true);
        }}
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className="w-72 rounded-[var(--r-panel)] border-0 bg-[var(--surface-tile)] px-3.5 py-3 text-sm leading-5 text-fg-primary ![box-shadow:var(--elev-popover)] [&_strong]:font-semibold"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {term && <p className="mb-1.5 font-semibold">{term}</p>}
        <div>{children}</div>
      </PopoverContent>
    </Popover>
  );
}
