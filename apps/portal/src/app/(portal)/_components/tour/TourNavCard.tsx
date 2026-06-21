"use client";

import { Compass, X } from "lucide-react";
import { cn } from "@eins/ui";
import { useTour } from "./TourProvider";

/**
 * Compact tour re-entry card for the left nav. Appears (below Leitfaden, above
 * the help group) once the first-login prompt was skipped or the tour
 * abandoned, and disappears for good when the user X's it or finishes the tour.
 * Visibility + dismissal are owned by TourProvider; this is pure presentation.
 *
 * Rendered in both the desktop rail and the mobile drawer, so it self-hides
 * when not visible rather than being conditionally mounted by the parent.
 */
export function TourNavCard({ className }: { className?: string }) {
  const { navCardVisible, dismissNavCard, startCore, isRunning } = useTour();
  if (!navCardVisible) return null;

  return (
    <div
      className={cn(
        "relative rounded-xl border border-accent/40 bg-bg-secondary p-3",
        className
      )}
    >
      <button
        type="button"
        onClick={dismissNavCard}
        aria-label="Hinweis ausblenden"
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-primary hover:text-fg-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={startCore}
        disabled={isRunning}
        className="flex w-full items-start gap-2.5 pr-5 text-left disabled:opacity-60"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent/40 text-accent">
          <Compass className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg-primary">
            Portal-Rundgang
          </span>
          <span className="block text-xs text-fg-secondary">
            Kurze Tour erneut starten
          </span>
        </span>
      </button>
    </div>
  );
}
