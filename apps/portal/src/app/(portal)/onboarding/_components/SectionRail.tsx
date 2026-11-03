"use client";

import { useEffect, useState } from "react";
import { cn } from "@eins/ui";
import { SKELETON_BAR } from "../_lib/sizes";
import { StatusWord, type OnboardingStatus } from "./StatusWord";

export interface RailEntry {
  /** Anchor id of the section card. */
  id: string;
  title: string;
  status: OnboardingStatus;
}

/**
 * From xl, the rail beside the cards: Leitfaden's "Auf dieser Seite"
 * (Vercel's docs, hairline track, the section in view dark), each entry with
 * its status word under the name (GOV.UK's task list), so the open sections
 * show at a glance. Plain anchors. `skeleton` draws bars for the status words.
 */
export function SectionRail({
  entries,
  active,
  skeleton = false,
}: {
  entries: RailEntry[];
  active: string | null;
  skeleton?: boolean;
}) {
  return (
    <nav aria-label="Abschnitte" className="sticky top-8 hidden xl:block">
      <p className="text-sm font-medium leading-5 text-fg-primary">Abschnitte</p>
      <ul className="mt-3 border-l border-border">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              aria-current={e.id === active ? "location" : undefined}
              className={cn(
                "-ml-px block border-l-2 py-1.5 pl-3 text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                e.id === active
                  ? "border-fg-primary font-medium text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary"
              )}
            >
              {e.title}
              <span className="mt-0.5 flex h-5 items-center font-normal">
                {skeleton ? <span className={cn(SKELETON_BAR, "h-3.5 w-16")} /> : <StatusWord status={e.status} />}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The section in view: the last one whose top has passed 96 px (Leitfaden's
 * hook); at the foot of the page the last section, however short.
 */
export function useActiveSection(ids: string[]): string | null {
  const key = ids.join(",");
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    const list = key ? key.split(",") : [];
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 96) current = id;
      }
      const doc = document.documentElement;
      if (list.length && window.scrollY + window.innerHeight >= doc.scrollHeight - 2) current = list[list.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return active;
}
