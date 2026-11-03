/**
 * Sizes of "Anfrage anlegen" (DESIGN.md section 10, "Fixed size"), shared by
 * the page and its skeleton so both always match. Nothing in the card grows:
 * an error goes to the toast and rings its field.
 */

/** The width of the Nachrichten pages, left on the canvas. */
export const PAGE_WIDTH = "max-w-3xl";

/** Gap between the head and the card (Einstellungen' `STACK`). */
export const STACK = "space-y-4 md:space-y-6";

/** One answer of "Wie kam die Person zu Ihnen?": the circle and its word, a control high. */
export const SOURCE_ROW =
  "-mx-2 flex h-[var(--control-h)] cursor-pointer items-center gap-3 rounded-[var(--r-control)] px-2 transition-colors hover:bg-[var(--hover-wash)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent";

/** The browser's own circle in the text colour, no mint (Einstellungen' `CHECKBOX`). */
export const RADIO = "h-5 w-5 shrink-0 cursor-pointer accent-fg-primary focus-visible:outline-none";

/** The answers: one column on the phone, two from sm. */
export const SOURCE_GRID = "grid gap-x-4 sm:grid-cols-2";

/**
 * A field an error names: a red line around it, the field keeps its size.
 * An outline like the sign-in fields (auth-ui), not a ring: `.elev-inset`
 * sets the field's box-shadow and would hide a ring.
 */
export const INVALID = "outline outline-2 outline-offset-0 outline-tone-bad";

/**
 * The card's foot (Einstellungen' `CardFoot`): the guarantee sentence above
 * the button on the phone, where beside it the sentence would run seven
 * lines; one row from sm.
 */
export const FOOT =
  "flex flex-col items-end gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6";
