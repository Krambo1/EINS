"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@eins/ui";
import { DashCard, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { CardEmptyNote } from "../../dashboard/_components/card-notes";
import { STEP_BOX, STEP_LIST, STEP_TEXT } from "../_lib/sizes";
import type { StepRow } from "../_lib/steps";
import { StepTitle, type StepState } from "./StepGlyph";

/**
 * One card of the page ("In Arbeit", "Als Nächstes", "Erledigt"): the card
 * title and its glyph name the state of every step in it (Linear's issues
 * grouped by status), so a row is only the title and one meta line (Linear's
 * two-line rows). A step with a description opens it in place as plain text
 * under the meta line, the row and its text one washed block, one at a time
 * (Vercel's deployment rows). The card keeps its height; a long text scrolls
 * with the list.
 */
export function StepCard({
  id,
  state,
  title,
  rows,
  empty,
  className,
}: {
  id: string;
  state: StepState;
  title: string;
  rows: StepRow[];
  /** One sentence when the card has no steps. */
  empty: string;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <DashCard
      id={id}
      title={<StepTitle state={state}>{title}</StepTitle>}
      className={cn("flex scroll-mt-4 flex-col", className)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {rows.length === 0 ? (
        <CardEmptyNote>{empty}</CardEmptyNote>
      ) : (
        <ul className={STEP_LIST}>
          {rows.map((row) => (
            <StepItem
              key={row.id}
              row={row}
              open={openId === row.id}
              onToggle={() => setOpenId((open) => (open === row.id ? null : row.id))}
            />
          ))}
        </ul>
      )}
    </DashCard>
  );
}

function StepItem({ row, open, onToggle }: { row: StepRow; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const panelId = `schritt-${row.id}`;

  // An opened step low in the list scrolls up inside the card until its text
  // shows, never past its own title.
  useEffect(() => {
    const li = ref.current;
    const list = li?.parentElement;
    if (!open || !li || !list) return;
    const box = li.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    const over = Math.min(box.bottom - view.bottom, box.top - view.top);
    if (over > 0) list.scrollBy({ top: over, behavior: "smooth" });
  }, [open]);

  const text: ReactNode = (
    <span className="min-w-0 flex-1">
      {/* Long titles wrap, never cut. */}
      <span className="block break-words text-[15px] font-medium leading-5 text-fg-primary">{row.title}</span>
      <span className="mt-1 block text-sm leading-5 tabular-nums text-fg-secondary">{row.meta.join(" · ")}</span>
    </span>
  );
  return (
    // 4 px white inside the hairlines (WASH_ROW), the grey area inside it:
    // the row and its opened text one block, 12 px past the text at the sides.
    <li ref={ref} className={WASH_ROW}>
      <div
        className={cn(
          WASH_AREA,
          "rounded-[var(--r-panel)] transition-colors",
          open ? "bg-[var(--hover-wash)]" : row.description && "hover:bg-[var(--hover-wash)]"
        )}
      >
        {row.description ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className={cn(
              STEP_BOX,
              // The focus ring spans the grey area.
              "-mx-3 w-[calc(100%+1.5rem)] rounded-[var(--r-panel)] px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            )}
          >
            {text}
            <ChevronDown
              aria-hidden
              className={cn("h-5 w-5 shrink-0 text-fg-secondary transition-transform duration-200", open && "rotate-180")}
            />
          </button>
        ) : (
          <div className={STEP_BOX}>
            {text}
            <span aria-hidden className="h-5 w-5 shrink-0" />
          </div>
        )}
        {open && row.description && (
          <p id={panelId} className={STEP_TEXT}>
            {row.description}
          </p>
        )}
      </div>
    </li>
  );
}
