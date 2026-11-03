import type { CSSProperties } from "react";

/**
 * Sizes shared by the Einstellungen pages and their `loading.tsx`, so every
 * skeleton has its page's shape and every list its slots (DESIGN.md
 * section 10). The subpages use the same column, so the main page and every
 * page below it are one width.
 */

/** Gap between the blocks of the page and between the cards. */
export const STACK = "space-y-4 md:space-y-6";

/**
 * From xl the cards and the section rail ("Auf dieser Seite") side by side,
 * as on the Leitfaden. Subpages keep the rail column empty, so their cards
 * are as wide as the main page's.
 */
export const COLUMNS = "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:items-start xl:gap-12";

/**
 * Where a jump to a card stops: under the phone header (56 px) with 16 px to
 * spare; from md nothing is sticky above the cards.
 */
export const SECTION_SCROLL = "scroll-mt-[4.5rem] md:scroll-mt-8";

/** Inner padding of a card body and its foot (DashCard's). */
export const CARD_PAD = "px-5 md:px-6";

/**
 * A field to type into: pressed into the card (DESIGN.md section 5, a place
 * where something is written), white while it has the focus. 16 px text on
 * the phone, so iOS does not zoom in on focus.
 */
export const FIELD =
  "elev-inset h-[var(--control-h)] w-full rounded-[var(--r-control)] border-0 bg-[var(--well)] px-3.5 text-base text-fg-primary placeholder:text-fg-tertiary focus:bg-[var(--surface-tile)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 sm:text-[15px]";

/** A choice from a list (Rolle, Abstand): the field's look, room for the arrow. */
export const SELECT = `${FIELD} cursor-pointer appearance-none pr-10`;

/** A box to tick: the browser's own, in the text colour (no mint). */
export const CHECKBOX = "mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-fg-primary";

/**
 * A row of a list (Team, Standorte, Behandlungen, Protokoll): a name and one
 * meta line, 64 px at every width. Long values stay on their line and scroll
 * sideways (`ONE_LINE`), so no row ever grows.
 */
export const LIST_ROW = "flex h-16 items-center gap-3";

/**
 * A row of "Abstand je Behandlung": on the phone and tablet the choice takes
 * a line of its own under the name (120 px), from lg it sits at the right
 * end (64 px).
 */
export const INTERVAL_ROW = "grid h-[7.5rem] content-center gap-2 lg:flex lg:h-16 lg:items-center lg:justify-between lg:gap-4";

/**
 * A link row (Start-Unterlagen) that turns grey on hover: the grey part is
 * 48 px, 12 px above and below its line and past it at the sides
 * (`WASH_AREA`), inside 4 px of white on the `li` (`WASH_ROW`), so the row is
 * 56 px and the grey never touches a hairline (DESIGN.md section 5, "Grey
 * areas keep breathing room").
 */
export const LINK_ROW = "flex h-12 items-center gap-3";

/** One line that never wraps or cuts: it scrolls sideways with edge shadows. */
export const ONE_LINE = "scroll-shadows-x whitespace-nowrap [--scroll-bg:var(--surface-tile)]";

/**
 * Rows a list shows before it scrolls, so a card keeps one height whether
 * it holds one entry or twenty (DESIGN.md section 10).
 */
export const SLOTS = { team: 4, standorte: 3, behandlungen: 5, abstaende: 4, protokoll: 6 } as const;

/**
 * A list of `--slots` rows that scrolls past them, a hairline above every
 * row. It reaches 4 px past the card's text edge on both sides (and pads it
 * back), so the raised buttons at the row ends keep their ring and shadow
 * inside the scroll box; the hairlines stay on the rows, level with the
 * fields above.
 */
const LIST_BASE =
  "scroll-shadows -mx-1 px-1 [--scroll-bg:var(--surface-tile)] [&>li]:border-t [&>li]:border-border";
export const LIST = `${LIST_BASE} h-[calc(var(--slots)*4rem)]`;
export const INTERVAL_LIST = `${LIST_BASE} h-[calc(var(--slots)*7.5rem)] lg:h-[calc(var(--slots)*4rem)]`;

export function slots(n: number): CSSProperties {
  return { "--slots": n } as CSSProperties;
}

/** Grey bar standing in for text in a skeleton. */
export const SKELETON_BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
