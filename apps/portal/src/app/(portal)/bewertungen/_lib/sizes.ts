/**
 * Fixed heights of the Bewertungen cards (DESIGN.md section 10, "Fixed
 * size"), shared by the pages and their skeletons so both always match.
 * One height per breakpoint; the content inside a card never changes it.
 */

/**
 * Where the top cards sit (one grid, DESIGN.md section 3). Phone and md: one
 * column. lg: "Neues Patientenfeedback" across, the two platforms in halves.
 * From 1400 px one row of thirds: below that a third is too narrow for both
 * buttons of a tile side by side.
 */
export const TOP_GRID = "grid gap-4 md:gap-6 lg:grid-cols-2 min-[1400px]:grid-cols-3";
export const TOP_FEEDBACK_SPAN = "lg:col-span-2 min-[1400px]:col-span-1";

/** "Neues Feedback" and each platform tile (room for the tile's two meta lines). */
export const TOP_CARD_HEIGHT = "h-[20.5rem]";

/** Rows the "Neues Patientenfeedback" card has room for. */
export const NEW_FEEDBACK_SLOTS = 3;

/** One template's text: four lines on the phone, three from lg. */
export const TEMPLATE_WELL_HEIGHT = "h-[7.5rem] lg:h-24";

/** Template slots per group (the largest group has three). */
export const TEMPLATE_SLOTS = 3;

/** Rows the Verlauf body shows before it scrolls (two platforms, three stands). */
export const HISTORY_SLOTS = 6;
/** One Verlauf row, 44 px including its divider. */
export const HISTORY_ROW_HEIGHT = "h-11";
/** The Verlauf body: HISTORY_SLOTS rows. */
export const HISTORY_BODY_HEIGHT = "h-[16.5rem]";

/** Rows per page of the Rückmeldungen list. */
export const FEEDBACK_PAGE_SIZE = 10;
/** One row of two lines; a name that wraps makes it taller and the body scrolls. */
export const FEEDBACK_ROW_HEIGHT = "min-h-16";
/** The list body: FEEDBACK_PAGE_SIZE rows of 64 px and the nine hairlines between them. */
export const FEEDBACK_BODY_HEIGHT = "h-[40.5625rem]";

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
