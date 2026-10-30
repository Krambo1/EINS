"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@eins/ui";

interface Tab {
  href: string;
  label: string;
}

/**
 * The two Bewertungen tabs as the period switch on the Übersicht (Triple
 * Whale's range switch): a track pressed into the canvas, the open tab
 * raised. Equal segments, so the marker only needs the index; it moves on
 * the tap, before the other tab has loaded. Full width on the phone, as wide
 * as the labels from md, where it is the page's first row.
 */
export function BewertungenTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const activeHref = tabs
    .slice()
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href;

  // The tapped tab, until the navigation has landed.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [pathname]);
  const shown = picked ?? activeHref;
  const index = tabs.findIndex((t) => t.href === shown);

  return (
    <nav aria-label="Bewertungen Bereiche">
      <div
        className="elev-inset relative grid h-[var(--track-h)] w-full gap-1 rounded-[var(--r-panel)] bg-[var(--surface-inset)] p-1 md:inline-grid md:w-auto"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className={cn(
            "elev-raised pointer-events-none absolute bottom-1 left-1 top-1 rounded-[var(--r-control)] bg-[var(--surface-raised)] transition-[transform,opacity] duration-300 ease-expo",
            index < 0 && "opacity-0"
          )}
          style={{
            width: `calc((100% - 0.5rem - ${(tabs.length - 1) * 0.25}rem) / ${tabs.length})`,
            transform: `translateX(calc(${Math.max(index, 0)} * (100% + 0.25rem)))`,
          }}
        />
        {tabs.map((tab) => {
          const active = tab.href === shown;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              // The whole other tab is fetched ahead, so the switch shows it
              // at once instead of its skeleton (production only; dev never
              // prefetches).
              prefetch
              aria-current={tab.href === activeHref ? "page" : undefined}
              onClick={() => setPicked(tab.href)}
              className={cn(
                "relative flex items-center justify-center whitespace-nowrap rounded-[var(--r-control)] px-3 text-[15px] font-medium transition-colors duration-300 md:px-5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active ? "text-fg-primary" : "text-fg-secondary hover:text-fg-primary"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Same footprint as the switch, for the skeletons. */
export function BewertungenTabsSkeleton({ active }: { active: 0 | 1 }) {
  return (
    <div aria-hidden className="elev-inset relative grid h-[var(--track-h)] w-full grid-cols-2 gap-1 rounded-[var(--r-panel)] bg-[var(--surface-inset)] p-1 md:inline-grid md:w-auto">
      {["Plattformen", "Patientenfeedback"].map((label, i) => (
        <span
          key={label}
          className={cn(
            "flex items-center justify-center whitespace-nowrap rounded-[var(--r-control)] px-3 text-[15px] font-medium md:px-5",
            i === active ? "elev-raised bg-[var(--surface-raised)] text-fg-primary" : "text-fg-secondary"
          )}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
