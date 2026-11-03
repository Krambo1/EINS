/**
 * Sizes shared by the page and `loading.tsx`, so the skeleton has the page's
 * shape and every closed row its height (DESIGN.md section 10).
 */

/** Gap between the blocks of the page and between the cards. */
export const STACK = "space-y-4 md:space-y-6";

/** From xl the cards and the section rail ("Auf dieser Seite") side by side. */
export const COLUMNS = "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:items-start xl:gap-12";

/**
 * A closed row's button: 12 px above and below the title (DESIGN.md section
 * 5), at least 48 px, so a one-line row is 56 px with the 4 px white of
 * `WASH_ROW` above and below. A title that wraps makes the row taller.
 */
export const ROW = "min-h-12 py-3";

/** "Vollständiges PDF" and its slot in the skeleton (185 px, its label's width). */
export const PDF_WIDTH = "w-[11.5625rem]";

/** Group head (Linear's group header) and the room above every group but the first. */
export const GROUP_GAP = "mt-4";

/**
 * Where a jump to a section stops: under the phone header (56 px) and the
 * sticky search band (60 px) with 16 px to spare; from md nothing is sticky
 * above the cards.
 */
export const SECTION_SCROLL = "scroll-mt-[8.25rem] md:scroll-mt-8";
