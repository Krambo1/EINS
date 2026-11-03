/**
 * Sizes of the public Freigabe page (/freigabe/<token>), shared with its
 * skeleton (`[token]/loading.tsx`), so nothing jumps when the page arrives
 * (DESIGN.md section 10, "Fixed size").
 *
 * One column below lg, from lg Inhalte's "Zur Freigabe": the post on the
 * left, title, text and decision on the right. Every state (open, change
 * mode, error, decided, withdrawn, expired, not found, rate limited) uses the
 * same frame width.
 */

/** The frame: logo row and card, one width for every state. */
export const FRAME_WIDTH = "max-w-[40rem] lg:max-w-[64rem]";

/** The card's body: one column, from lg the post column beside the rest (the tile keeps its own height). */
export const CARD_BODY = "pt-5 md:pt-6 lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-8";

/**
 * The file inside the post: one height per breakpoint, letterboxed and never
 * cropped, capped by the screen so a portrait Reel never runs past the fold
 * (a 9:16 Reel at full width was about 1,200 px high on a computer).
 */
export const MEDIA_FRAME =
  "h-[min(26rem,calc(100svh-17rem))] sm:h-[min(30rem,calc(100svh-17rem))] lg:h-[min(34rem,calc(100svh-14rem))]";

/** The title column's first element: under the post below lg, beside it from lg. */
export const TITLE_TOP = "mt-4 lg:mt-0";

/**
 * The post's text: a pressed-in well of one height that scrolls (Inhalte's
 * "Text zum Beitrag"), so the buttons sit the same distance under the file
 * for every post. "Änderung wünschen" puts the label row and the field in
 * exactly this space (`FIELD`), so nothing below moves.
 */
export const WELL = "h-[12rem] sm:h-[13.5rem] lg:h-[16rem]";
/** The change field: the well's height less its label row (20 px) and the gap under it (6 px). */
export const FIELD = "h-[calc(12rem-1.625rem)] sm:h-[calc(13.5rem-1.625rem)] lg:h-[calc(16rem-1.625rem)]";

/**
 * The decision's band: a hairline, then the two slots. From sm Inhalte's two
 * slots side by side; on the phone one above the other at full width, since
 * "Änderung wünschen" does not fit half of a 390 px card (Stripe Checkout and
 * DocuSign put their one button across the phone).
 */
export const DECISION_BAND = "mt-4 border-t border-border pt-4";
export const SLOTS = "grid grid-cols-1 gap-2 sm:h-[var(--control-h)] sm:w-[23rem] sm:grid-cols-2";
/** The slots' row, empty, for the buttons that stand over it. */
export const SLOT_ROW = "h-[calc(var(--control-h)*2+0.5rem)] sm:h-[var(--control-h)]";
/** Slot positions for a control placed over the slot row (absolute, in the box that ends with the band). */
export const SLOT_LEFT =
  "inset-x-0 bottom-[calc(var(--control-h)+0.5rem)] sm:bottom-0 sm:right-auto sm:w-[11.25rem]";
export const SLOT_RIGHT = "inset-x-0 bottom-0 sm:left-[11.75rem] sm:right-auto sm:w-[11.25rem]";
