/**
 * Fixed heights of the Bewertungen cards (DESIGN.md section 10, "Fixed
 * size"), shared by the pages and their skeletons so both always match.
 * One height per breakpoint; the content inside a card never changes it.
 */

/**
 * Where the top cards sit (one grid, DESIGN.md section 3). Phone and md: one
 * column. lg: the two platforms in halves, "Neues Patientenfeedback" across
 * under them. From 1400 px one row of thirds, the feedback card on the right:
 * below that a third is too narrow for both buttons of a tile side by side.
 */
export const TOP_GRID = "grid gap-4 md:gap-6 lg:grid-cols-2 min-[1400px]:grid-cols-3";
export const TOP_FEEDBACK_SPAN = "lg:col-span-2 min-[1400px]:col-span-1";

/**
 * "Neues Feedback" and each platform tile: room for the tile's two meta
 * lines and for the feedback card's three rows of 76 px (68 px wash and 4 px
 * white above and below, DESIGN.md section 5).
 */
export const TOP_CARD_HEIGHT = "h-[21.875rem]";

/** Rows the "Neues Patientenfeedback" card has room for. */
export const NEW_FEEDBACK_SLOTS = 3;

/**
 * One Antwortvorlage between the hairlines: 4 px stay white above and below,
 * so the row's grey wash never touches a hairline or the next row's wash
 * (DESIGN.md section 5, "Grey areas keep breathing room"; Hilfe's `ROW`).
 */
export const TEMPLATE_ROW = "py-1";
/**
 * The row's button: 12 px between the title and the wash's edge (`-mx-3
 * px-3` across), at least 48 px high, so a one-line row is 56 px. A title
 * that wraps makes it taller, never cut.
 */
export const TEMPLATE_ROW_BOX = "min-h-12 py-3";
/** Room above every Antwortvorlagen group but the first. */
export const TEMPLATE_GROUP_GAP = "mt-4";

/** Rows the Verlauf body shows before it scrolls (two platforms, three stands). */
export const HISTORY_SLOTS = 6;
/** One Verlauf row, 44 px including its divider. */
export const HISTORY_ROW_HEIGHT = "h-11";
/** The Verlauf body: HISTORY_SLOTS rows. */
export const HISTORY_BODY_HEIGHT = "h-[16.5rem]";

/** Rows per page of the Rückmeldungen list. */
export const FEEDBACK_PAGE_SIZE = 10;
/**
 * One row of two lines in its grey wash: 12 px above and below the two
 * lines (DESIGN.md section 5), 68 px; a name that wraps makes it taller and
 * the body scrolls. Also the rows of "Neues Feedback".
 */
export const FEEDBACK_ROW_HEIGHT = "min-h-[4.25rem]";
/** The list body: FEEDBACK_PAGE_SIZE rows of 68 px, each with 4 px white above and below, and the nine hairlines. */
export const FEEDBACK_BODY_HEIGHT = "h-[48.0625rem]";

/**
 * The Rückmeldung page: the record column from xl (Attio's and Linear's
 * details sidebar, on the right), the patient's text and the note as wells
 * of fixed height that scroll inside.
 */
export const DETAIL_GRID =
  "grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]";
/**
 * A record row: label column (the longest label, "Erledigt", fits) and value.
 * At 22rem the value has about 220 px, room for a usual e-mail address.
 */
export const FACT_COLUMNS = "grid-cols-[4.5rem_minmax(0,1fr)]";
/** The name at the top of the record: up to three lines, then it scrolls. */
export const RECORD_NAME_HEIGHT = "h-[4.5rem]";
export const DETAIL_TEXT_HEIGHT = "h-48 md:h-56";
export const NOTE_HEIGHT = "h-40 md:h-44";
