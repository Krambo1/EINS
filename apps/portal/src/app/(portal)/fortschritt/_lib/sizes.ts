/**
 * Fixed sizes of the Fortschritt cards (DESIGN.md section 10, "Fixed size"),
 * shared by the page and its skeleton so both always match. One height per
 * breakpoint; how many steps there are and how long their texts are never
 * change it. Measured with tools/fixed-size-fortschritt-wash.cjs.
 */

/**
 * Phone and md: the three cards stacked. From lg "In Arbeit" over
 * "Als Nächstes" on the left, "Erledigt" the height of both on the right.
 */
export const GRID = "grid gap-4 md:gap-6 lg:grid-cols-2";
export const DONE_PLACE = "lg:col-start-2 lg:row-span-2 lg:row-start-1";

/**
 * One step: title and one meta line, 12 px above and below (68 px), the
 * chevron slot at the end. It sits in the row's grey area (WASH_AREA, 12 px
 * at the sides) inside 4 px white (WASH_ROW), so a slot takes 76 px.
 */
export const STEP_BOX = "flex min-h-[4.25rem] items-center gap-3 py-3 text-left";

/**
 * The description of an opened step: plain text under the meta line, inside
 * the row's wash, lined up with the title (the chevron's column stays free).
 */
export const STEP_TEXT =
  "-mt-1 whitespace-pre-wrap break-words pb-3 pr-8 text-[15px] leading-5 text-fg-primary";

/**
 * "In Arbeit" and "Als Nächstes": five step slots (the default journey runs
 * five steps at once in week 1) plus four lines of an opened description
 * (88 px), so opening a step never resizes the card. More steps and longer
 * texts scroll inside.
 */
export const PLAN_CARD_HEIGHT = "h-[35rem] md:h-[35.5rem]";

/**
 * "Erledigt": six slots and four lines of an opened description below lg;
 * from lg as high as the two cards beside it and the gap between them.
 */
export const DONE_CARD_HEIGHT = "h-[39.8125rem] md:h-[40.3125rem] lg:h-[72.5rem]";

/** Slots the skeleton draws per card ("Erledigt": as many as fit from lg). */
export const PLAN_SLOTS = 5;
export const DONE_SLOTS = 14;

/**
 * The list of a card: hairlines between the steps, a long list scrolls inside.
 * 12 px wider than the card content on each side, so a row's grey area
 * (WASH_AREA) is never cut by the scroll box.
 */
export const STEP_LIST =
  "scroll-shadows -mx-3 min-h-0 flex-1 divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)]";

/** Placeholder bar of the skeleton. */
export const SKELETON_BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
