"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@eins/ui";

interface Tab {
  href: string;
  label: string;
}

export function BewertungenTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  const activeHref = tabs
    .slice()
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href;

  return (
    <nav aria-label="Bewertungen Bereiche" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-1 text-sm">
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center border-b-2 px-4 py-3 font-medium transition-colors",
                  active
                    ? "border-fg-primary text-fg-primary"
                    : "border-transparent text-fg-secondary hover:border-border hover:text-fg-primary"
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
