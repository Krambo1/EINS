"use client";

import { cn } from "@eins/ui";
import { EINS_CONTACT } from "@/lib/constants";

/**
 * Sidebar contact card. Lives in the flex gap above the bottom-anchored
 * "Hilfe" entry in {@link PortalShellClient}, a warm path to a Strategie-Gespräch
 * (EINS's primary KPI).
 *
 * Presentational only; shows the shared {@link EINS_CONTACT} identity.
 */
export function SidebarContactCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-xl border border-border bg-bg-secondary p-2",
        className
      )}
    >
      <a
        href={EINS_CONTACT.bookingUrl}
        target="_blank"
        rel="noreferrer"
        title={EINS_CONTACT.email}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-fg-primary">
            {EINS_CONTACT.name}
          </span>
          <span className="block truncate text-sm text-fg-secondary">
            Gespräch buchen
          </span>
        </span>
      </a>
    </div>
  );
}
