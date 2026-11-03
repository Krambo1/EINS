/**
 * Sizes shared by the sign-in pages and their `loading.tsx`, so a skeleton
 * has its page's shape and the card top, the title and the main button stay
 * where they are while the page loads (DESIGN.md section 10).
 */

/**
 * Where the card stands: anchored at the top, never centred, so a card that
 * grows (the password step, the Postfach screen) grows downward only. 16 px
 * from the phone's edges; from sm max(4 rem, 12 vh) from the top, 108 px on
 * a 1440 x 900 screen.
 */
export const AUTH_MAIN = "flex justify-center px-4 pb-4 pt-4 sm:pt-[max(4rem,12vh)]";

/**
 * Datenschutz and Impressum, right under the card rather than at the
 * screen's foot, where the toast (16 px from the phone's bottom edge) would
 * cover them until it is closed.
 */
export const AUTH_LEGAL = "flex justify-center px-4 pb-10";

/** One card width for every sign-in page, admin included. */
export const AUTH_COLUMN = "w-full max-w-[400px]";

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
