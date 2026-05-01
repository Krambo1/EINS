"use client";

import * as React from "react";

interface RailItem {
  id: string;
  label: string;
  count: number;
}

/**
 * Sticky vertical nav for the dense scroll view. Highlights the current
 * section by hash on click; intersection-observer keeps it in sync as
 * the user scrolls.
 */
export function SectionRail({ items }: { items: RailItem[] }) {
  const [active, setActive] = React.useState<string>(items[0]?.id ?? "");

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const observers: IntersectionObserver[] = [];
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (!el) continue;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) setActive(it.id);
          }
        },
        { rootMargin: "-30% 0px -50% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, [items]);

  return (
    <nav
      aria-label="Operations-Sektionen"
      className="sticky top-28 hidden w-56 shrink-0 space-y-1 lg:block"
    >
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
        Sprung
      </span>
      <ul className="mt-2 space-y-0.5">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
                active === it.id
                  ? "bg-accent-soft text-accent"
                  : "text-fg-primary hover:bg-bg-secondary/60"
              }`}
            >
              <span>{it.label}</span>
              {it.count > 0 && (
                <span className="font-mono text-xs tabular-nums text-fg-secondary">
                  {it.count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
