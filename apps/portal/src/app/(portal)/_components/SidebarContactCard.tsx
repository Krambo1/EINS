"use client";

import { Headset, X } from "lucide-react";
import { cn } from "@eins/ui";
import { EINS_CONTACT } from "@/lib/constants";

export interface SidebarContact {
  /** Display name — a person ("Lisa Brandt") or the team ("Ihr EINS-Team"). */
  name: string;
  /** Calendly (or similar) booking link opened in a new tab. */
  bookingUrl: string;
  /** Fallback contact channel, surfaced as a hover hint on the avatar. */
  email: string;
}

/**
 * Sidebar contact card. Lives in the flex gap above the bottom-anchored
 * "System" group in {@link PortalShell}, a warm path to a Strategie-Gespräch
 * (EINS's primary KPI).
 *
 * Two states, controlled by the parent (which persists the choice to a
 * cookie):
 *  - expanded: a single compact, clickable row (avatar + name + action) with a
 *    minimize button.
 *  - minimized: just the mint icon, which expands the card again on click.
 *
 * Presentational only; defaults to the shared {@link EINS_CONTACT} identity.
 */
export function SidebarContactCard({
  contact = EINS_CONTACT,
  collapsed,
  onToggle,
  className,
}: {
  contact?: SidebarContact;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  className?: string;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onToggle(false)}
        title="Ansprechpartner anzeigen"
        aria-label="Ansprechpartner anzeigen"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
          className
        )}
      >
        <Headset className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-xl border border-border bg-bg-secondary p-2",
        className
      )}
    >
      <a
        href={contact.bookingUrl}
        target="_blank"
        rel="noreferrer"
        title={contact.email}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Headset className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[0.8rem] font-semibold text-fg-primary">
            {contact.name}
          </span>
          <span className="block truncate text-[0.7rem] text-fg-secondary">
            Gespräch buchen
          </span>
        </span>
      </a>
      <button
        type="button"
        onClick={() => onToggle(true)}
        title="Minimieren"
        aria-label="Minimieren"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
