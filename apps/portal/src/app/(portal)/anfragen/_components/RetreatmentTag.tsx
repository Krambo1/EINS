import { cn } from "@eins/ui";
import type { RetreatmentTagState } from "@/server/queries/retreatments";

const DOT: Record<RetreatmentTagState, string> = {
  faellig: "bg-tone-warn",
  termin: "bg-tone-good",
  bald: "bg-fg-tertiary",
};

/**
 * A Wiederbehandlung where a row shows its status, as a dot and one word
 * like StatusPill (Karam, 2026-10-29: a tag in the list instead of a card of
 * its own). Amber: due now, green: a date, grey: due later. The full words
 * (tagText: Behandlung, since when, which date) are its hover text and what
 * screen readers read. Never wider than the list's status column.
 */
export function RetreatmentTag({
  state,
  text,
  className,
}: {
  state: RetreatmentTagState;
  text: string;
  className?: string;
}) {
  return (
    <span
      title={text}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap align-middle text-sm font-medium leading-5 text-fg-primary",
        className
      )}
    >
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", DOT[state])} />
      <span aria-hidden>Wiederbehandlung</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
