import { cn } from "@eins/ui";

export type StepState = "laeuft" | "geplant" | "abgeschlossen";

/**
 * The state of a card at a glance, before its title (Linear's status icons in
 * the group heads of "My issues"): an empty grey ring for "Als Nächstes", a
 * half-filled mint ring for "In Arbeit", a filled green circle with a tick for
 * "Erledigt". The shape differs as well as the colour, and the title stays
 * beside it, so colour is never the only signal.
 */
export function StepGlyph({ state, className }: { state: StepState; className?: string }) {
  const color =
    state === "laeuft" ? "text-accent" : state === "abgeschlossen" ? "text-[var(--tone-good)]" : "text-fg-tertiary";
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={cn("h-4 w-4 shrink-0", color, className)}>
      {state === "abgeschlossen" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M4.75 8.25 7 10.5l4.25-4.5" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {state === "laeuft" && <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

/** A card title with its state glyph. */
export function StepTitle({ state, children }: { state: StepState; children: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StepGlyph state={state} />
      {children}
    </span>
  );
}
