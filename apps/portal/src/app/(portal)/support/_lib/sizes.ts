/**
 * Fixed sizes of the Nachrichten pages (DESIGN.md section 10, "Fixed
 * size"), shared by the pages and their skeletons so both always match.
 * One height per breakpoint; the content inside a card never changes it.
 */

/**
 * One width for the list, a conversation and a new message, left on the
 * canvas like every page ("Anfrage anlegen" takes the same).
 */
export const PAGE_WIDTH = "max-w-3xl";

/** Gap between the head and the card (Einstellungen' `STACK`). */
export const STACK = "space-y-4 md:space-y-6";

/** "Neue Nachricht": a square with its icon below sm, so the title keeps its line; the word from sm. */
export const NEW_BUTTON = "w-[var(--control-h)] px-0 sm:w-auto sm:px-4";

/** The list card: 20 px from the text to every edge (24 px from md). */
export const LIST_CARD =
  "anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 py-1 md:px-6 md:py-2";

/**
 * One conversation in its grey wash, two lines (the Rückmeldungen' rows):
 * 12 px above and below, 68 px; a subject that wraps makes it taller and
 * the list scrolls.
 */
export const ROW_HEIGHT = "min-h-[4.25rem]";

/** Row slots of the skeleton: the list shows six before it scrolls on the phone, eight from md. */
export const LIST_SLOTS = 8;
/** The list body: 6 rows of 76 px and their 5 hairlines, from md 8 and 7. */
export const LIST_BODY_HEIGHT = "h-[28.8125rem] md:h-[38.4375rem]";

/**
 * A conversation fills the screen below the shell (Plain's and Intercom's
 * thread): the head, then one card whose messages scroll and whose answer
 * field stays at its foot. Phone: 57 px header bar and 16 px above and below;
 * from md 32 px above and below, as the sidebar. The notice above the page
 * (Start-Checkliste) is left out like in the sidebar.
 */
export const THREAD_PAGE_HEIGHT =
  "h-[max(32rem,calc(100svh-5.5625rem-var(--shell-notice)))] md:h-[max(32rem,calc(100svh-4rem-var(--shell-notice)))]";

/** The conversation card under the head: it takes the rest of that height, never less than 20rem. */
export const THREAD_CARD =
  "anim-rise elev-card flex min-h-[20rem] min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--r-card)] bg-[var(--surface-tile)]";

/**
 * A text field of several lines: the well of a field (Einstellungen'
 * `FIELD`), 16 px text on the phone so iOS does not zoom, white with the
 * focus. Its height comes from one of the two below.
 */
export const TEXT_AREA =
  "scroll-shadows elev-inset block w-full resize-none rounded-[var(--r-control)] border-0 px-3.5 py-3 text-base leading-6 text-fg-primary placeholder:text-fg-tertiary focus:[--scroll-bg:var(--surface-tile)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 sm:text-[15px]";

/** The answer field: three lines on the phone, so the messages keep the room, four from sm; then it scrolls. */
export const REPLY_HEIGHT = "h-24 sm:h-[7.5rem]";

/** The text of a new message: eight lines, then it scrolls. */
export const MESSAGE_HEIGHT = "h-[13.5rem]";
