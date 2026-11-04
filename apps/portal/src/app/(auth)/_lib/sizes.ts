/**
 * Sizes shared by the sign-in pages and their `loading.tsx`, so a skeleton
 * has its page's shape and the card top, the title and the main button stay
 * where they are while the page loads (DESIGN.md section 10).
 */

/**
 * Where the card stands: in the middle of the screen, phone and desktop
 * (Karam, 2026-11-03; before it was anchored at the top). 16 px from the
 * phone's edges and at least 16 px (32 px from sm) above and below, so a tall
 * card on a short screen scrolls instead of being cut.
 */
export const AUTH_MAIN = "flex flex-1 items-center justify-center px-4 py-4 sm:py-8";

/**
 * Datenschutz and Impressum, right under the card rather than at the
 * screen's foot, where the toast (16 px from the phone's bottom edge) would
 * cover them until it is closed.
 */
export const AUTH_LEGAL = "flex justify-center pt-3";

/**
 * One card width for every sign-in page, admin included. The column is as
 * tall as the sign-in card at its password step (with Google) and the legal
 * links, and the card sits at its top: centring the column, not the card,
 * keeps the logo and the title where they are when the password field
 * appears, and the card grows downward into the reserved room.
 */
export const AUTH_COLUMN = "flex min-h-[520px] w-full max-w-[400px] flex-col";

/** The portal's card: on the canvas, soft shadow, 20 px inside (24 from md). */
export const AUTH_CARD =
  "elev-card rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6";

/** The logo heading the card: 28 px high, the title 24 px below it. */
export const AUTH_LOGO_ROW = "flex h-7 items-center gap-2.5";
export const AUTH_TITLE_GAP = "mt-6";

/** From the title to what follows it (a sentence or the first field). */
export const AUTH_BODY_GAP = "mt-5";

/** Between the fields, rows and buttons of a form. */
export const AUTH_STACK = "space-y-4";

/** A field's label row (with room for a link at its right end). */
export const FIELD_LABEL_ROW = "flex min-h-6 items-center justify-between gap-3";

/** One rule under a new password: a dot and a line of text. */
export const RULE_ROW = "flex min-h-5 items-start gap-2";

/** Skeleton parts: a grey bar, and the title's bar in its 32 px line. */
export const SKELETON_BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
export const SKELETON_TITLE = `${SKELETON_BAR} my-1 h-6 w-44`;
