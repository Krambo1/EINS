"use client";

import { useState } from "react";
import { cn } from "@eins/ui";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

export interface SectionNavItem {
  key: string;
  /** Anchor id of the section card. */
  anchorId: string;
  title: string;
  /** Required questions answered in this section. */
  answeredRequired: number;
  totalRequired: number;
  /** All required questions answered (or, without required ones, anything answered). */
  complete: boolean;
}

interface SectionNavProps {
  items: SectionNavItem[];
  activeKey: string;
  onJump: (key: string) => void;
}

/**
 * Section list for the Fragebogen. Below xl: a sticky bar under the portal
 * header that opens into the list ("Abschnitt X von Y"). From xl: a sticky
 * column left of the form. Both are plain anchor links to the section cards;
 * the completion mark is derived from the form state by the caller.
 */
export function SectionNav({ items, activeKey, onJump }: SectionNavProps) {
  const [open, setOpen] = useState(false);
  const activeIndex = Math.max(
    0,
    items.findIndex((i) => i.key === activeKey)
  );
  const active = items[activeIndex];
  const doneCount = items.filter((i) => i.complete).length;

  const list = (onPick?: () => void) => (
    <ol className="space-y-1">
      {items.map((item, idx) => {
        const isActive = item.key === activeKey;
        return (
          <li key={item.key}>
            <a
              href={`#${item.anchorId}`}
              aria-current={isActive ? "location" : undefined}
              onClick={() => {
                onJump(item.key);
                onPick?.();
              }}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-primary transition-colors hover:bg-bg-secondary",
                isActive && "bg-bg-secondary font-semibold"
              )}
            >
              <span className="w-5 shrink-0 text-right tabular-nums">{idx + 1}.</span>
              <span className="min-w-0 flex-1">{item.title}</span>
              {item.complete ? (
                <CheckCircle2
                  className="h-5 w-5 shrink-0 text-tone-good"
                  aria-label="fertig"
                />
              ) : (
                <span className="shrink-0 tabular-nums">
                  <span aria-hidden="true">
                    {item.answeredRequired}/{item.totalRequired}
                  </span>
                  <span className="sr-only">
                    {item.answeredRequired} von {item.totalRequired} Pflichtfragen
                    beantwortet
                  </span>
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      {/* Phone and tablet: sticky bar that folds open. */}
      <nav
        aria-label="Abschnitte des Fragebogens"
        className="sticky top-16 z-30 mb-6 rounded-xl border border-border bg-bg-primary shadow-sm xl:hidden"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls="fragebogen-abschnitte"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-fg-primary">
              Abschnitt {activeIndex + 1} von {items.length} · {doneCount} fertig
            </span>
            <span className="block truncate text-base font-semibold text-fg-primary">
              {active?.title}
            </span>
          </span>
          {open ? (
            <ChevronUp className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <span className="sr-only">{open ? "Liste schließen" : "Alle Abschnitte zeigen"}</span>
        </button>
        {open && (
          <div id="fragebogen-abschnitte" className="border-t border-border p-2">
            {list(() => setOpen(false))}
          </div>
        )}
      </nav>

      {/* Desktop: sticky column next to the form. */}
      <nav
        aria-label="Abschnitte des Fragebogens"
        className="sticky top-20 hidden self-start xl:block"
      >
        <p className="px-3 text-base font-semibold text-fg-primary">
          Abschnitt {activeIndex + 1} von {items.length}
        </p>
        <p className="mb-3 px-3 text-sm text-fg-primary">
          {doneCount} von {items.length} Abschnitten fertig
        </p>
        {list()}
      </nav>
    </>
  );
}
