"use client";

import { useEffect, useState } from "react";
import { List } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from "@eins/ui";
import { CONTROL, CONTROL_SQUARE, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { TOC_LABEL } from "../_lib/labels";

export type SectionLink = { id: string; title: string };

/**
 * The cards to jump to, as on the Leitfaden (copied, since its parts are its
 * own): from xl Vercel's "On this page" rail beside the cards, below xl
 * Stripe's square list button in the title row. Both are plain anchors, so
 * every `/einstellungen#…` link keeps working, and both mark the card in view.
 */
export function SectionMenu({ sections, className }: { sections: SectionLink[]; className?: string }) {
  const active = useActiveSection(sections.map((s) => s.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={TOC_LABEL}
        className={cn(
          RAISED_CONTROL,
          CONTROL,
          CONTROL_SQUARE,
          "inline-flex shrink-0 items-center justify-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className
        )}
      >
        <List className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[15rem] overflow-auto rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]"
        // Focus stays where the jump went, not back on the button.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel className="text-fg-secondary">{TOC_LABEL}</DropdownMenuLabel>
        {sections.map((s) => (
          <DropdownMenuItem key={s.id} asChild>
            <a
              href={`#${s.id}`}
              aria-current={s.id === active ? "location" : undefined}
              className={cn(
                "flex min-h-[var(--control-h)] items-center text-[15px]",
                s.id === active ? "font-medium text-fg-primary" : "text-fg-secondary"
              )}
            >
              {s.title}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** From xl, level with the first card; the card in view dark with a dark bar, the rest grey. No mint. */
export function SectionRail({ sections }: { sections: SectionLink[] }) {
  const active = useActiveSection(sections.map((s) => s.id));
  return (
    <nav aria-label={TOC_LABEL} className="sticky top-8 hidden xl:block">
      <p className="text-sm font-medium leading-5 text-fg-primary">{TOC_LABEL}</p>
      <ul className="mt-3 border-l border-border">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={s.id === active ? "location" : undefined}
              className={cn(
                "-ml-px block border-l-2 py-1.5 pl-3 text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                s.id === active
                  ? "border-fg-primary font-medium text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary"
              )}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The card in view: the last one whose top has passed the line under the header. */
function useActiveSection(ids: string[]): string | null {
  const key = ids.join(",");
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    const list = key ? key.split(",") : [];
    let frame = 0;
    const measure = () => {
      frame = 0;
      // A jump stops 72 px from the top on the phone (header plus 16 px) and
      // 32 px from md, so a card counts once its top is above 96 px.
      const line = 96;
      let current = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // At the foot of the page the last card counts, however short.
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
