"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@eins/ui";

interface Item {
  key: string;
  label: string;
}

export function AuditTabsNav({
  tabs,
  current,
}: {
  tabs: Item[];
  current: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav className="flex items-center gap-1" aria-label="Audit">
      {tabs.map((t) => {
        const params = new URLSearchParams(searchParams.toString());
        if (t.key === "uebersicht") params.delete("tab");
        else params.set("tab", t.key);
        // Reset filter state on tab switch.
        for (const k of Array.from(params.keys())) {
          if (k !== "tab") params.delete(k);
        }
        const href = params.toString()
          ? `${pathname}?${params.toString()}`
          : pathname;
        const active = current === t.key;
        return (
          <Link
            key={t.key}
            href={href}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200",
              active ? "text-accent" : "text-fg-primary hover:text-accent"
            )}
          >
            {t.label}
            <span
              className={cn(
                "pointer-events-none absolute inset-x-3 -bottom-0.5 h-px origin-center bg-accent transition-transform duration-300 ease-expo",
                active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
