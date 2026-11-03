/**
 * Fixed sizes of the Anfrage page (DESIGN.md section 10, "Fixed size"),
 * shared by the page and its skeleton so both always match. One height per
 * breakpoint; what is inside a card never changes it.
 */

/**
 * One record layout (the Rückmeldung's, Attio's record page). Below xl one
 * column in the order of the questions: record, message, work, then the rest.
 * From xl the record column stands on the right (Linear's and Zendesk's
 * details sidebar) and the work column on the left. Each column is a wrapper
 * that is `contents` below xl, so its cards take part in the one column and
 * `order-*` puts them in place.
 *
 * With the Bearbeiten card the columns share two rows: the record stretches
 * to the end of Nachricht and Bearbeiten, so the gap under it lines up with
 * the gap above Verlauf. Without it (Nachricht alone is far shorter than the
 * record) each column runs on its own.
 */
export const DETAIL_GRID =
  "flex flex-col gap-4 md:gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:grid-rows-[auto_1fr] xl:gap-6";

/** The column wrappers and the top and rest wrappers inside each. */
export function detailColumns(aligned: boolean) {
  return aligned
    ? {
        record: "contents",
        recordTop: "contents xl:col-start-2 xl:row-start-1 xl:grid",
        recordRest: "contents xl:col-start-2 xl:row-start-2 xl:flex xl:flex-col xl:gap-6",
        work: "contents",
        workTop: "contents xl:col-start-1 xl:row-start-1 xl:flex xl:flex-col xl:gap-6",
        workRest: "contents xl:col-start-1 xl:row-start-2 xl:flex xl:flex-col xl:gap-6",
      }
    : {
        record: "contents xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:flex xl:flex-col xl:gap-6",
        recordTop: "contents",
        recordRest: "contents",
        work: "contents xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:flex xl:flex-col xl:gap-6",
        workTop: "contents",
        workRest: "contents",
      };
}

/** Phone order of the cards (the columns keep it from xl). */
export const ORDER = {
  record: "order-1",
  message: "order-2",
  work: "order-3",
  retreatment: "order-4",
  verlauf: "order-5",
  siblings: "order-6",
  details: "order-7",
} as const;

/**
 * A record row: label column (the longest label, "Wiedervorlage", fits) and
 * value. At 24rem the value has about 220 px, on a 390 phone about 200 px.
 */
export const FACT_COLUMNS = "grid-cols-[6.5rem_minmax(0,1fr)]";
/** A row of the Details card: longer labels ("48-Werkstunden-Frist"). */
export const DETAIL_FACT_COLUMNS = "grid-cols-[8.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]";
/** The name at the top of the record: up to three lines, then it scrolls. */
export const RECORD_NAME_HEIGHT = "h-[4.5rem]";

/** The well with the patient's message and answers. */
export const MESSAGE_HEIGHT = "h-44 md:h-48";
/** Label and value of an answer in the message well (the call card's pairs). */
export const PAIR_COLUMNS = "grid-cols-[6.5rem_minmax(0,1fr)]";

/** The text field of the composer, the same in all three tabs. */
export const COMPOSER_HEIGHT = "h-24 md:h-28";

/** The Verlauf body: planned Wiedervorlagen on top, then the history. */
export const VERLAUF_HEIGHT = "h-[26rem]";

/** Rows "Weitere Anfragen" has room for before it scrolls. */
export const SIBLING_SLOTS = 3;
/** SIBLING_SLOTS rows of 64 px and the hairlines between them. */
export const SIBLING_BODY_HEIGHT = "h-[12.125rem]";
