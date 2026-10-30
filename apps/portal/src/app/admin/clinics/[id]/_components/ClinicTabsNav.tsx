"use client";

import { usePathname } from "next/navigation";
import { PendingLink, usePendingParam } from "@/app/_components/instant-views";

export interface ClinicTabsNavItem {
  key: string;
  label: string;
}

/**
 * Tabs of the Praxis detail page. Each tab is a link with its `?tab=` (the
 * URL stays the source of truth, the server renders the panel); a switch
 * resets the tab's deep-link state. Inside the page's NavTransition the tab
 * marks itself on the tap and the old panel dims until the new one arrives.
 */
export function ClinicTabsNav({ tabs }: { tabs: ClinicTabsNavItem[] }) {
  const pathname = usePathname();
  const current = usePendingParam("tab", "uebersicht");

  return (
    <nav aria-label="Bereiche der Praxis" className="flex min-w-0 flex-wrap items-center gap-1">
      {tabs.map((t) => (
        <PendingLink
          key={t.key}
          href={t.key === "uebersicht" ? pathname : `${pathname}?tab=${t.key}`}
          param="tab"
          value={t.key}
          defaultValue="uebersicht"
          className="group relative whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200"
          activeClassName="text-accent"
          inactiveClassName="text-fg-primary hover:text-accent"
        >
          {t.label}
          {current === t.key && (
            <span className="pointer-events-none absolute inset-x-3 -bottom-0.5 h-px bg-accent" />
          )}
        </PendingLink>
      ))}
    </nav>
  );
}
