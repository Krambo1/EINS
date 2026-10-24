import type { DashboardRange } from "@/lib/dashboard-range";

/**
 * Plain-language window names shown as text in each dashboard card header,
 * so the owner sees at a glance which period a card's numbers cover. Matches
 * `dashboardRangeWindow` (1 / 30 / 365 / 1825 Berlin calendar days incl. today).
 */
export const RANGE_HEADER_TEXT: Record<DashboardRange, string> = {
  heute: "Heute",
  mon: "Letzte 30 Tage",
  jahr: "Letzte 12 Monate",
  max: "Letzte 5 Jahre",
};

/** Short names on the page-level switch. Same periods as RANGE_HEADER_TEXT,
 *  so the switch and a card's own label never name one window two ways. */
export const RANGE_SWITCH_TEXT: Record<DashboardRange, string> = {
  heute: "Heute",
  mon: "30 Tage",
  jahr: "12 Monate",
  max: "5 Jahre",
};

/** Sentence opener for empty-window notes ("Heute ist noch keine ..."). */
export const RANGE_SENTENCE_START: Record<DashboardRange, string> = {
  heute: "Heute",
  mon: "In den letzten 30 Tagen",
  jahr: "In den letzten 12 Monaten",
  max: "In den letzten 5 Jahren",
};

/** Shared first-day sentence for a Praxis without any Anfrage yet. */
export const FIRST_INQUIRY_NOTE = "Füllt sich, sobald die erste Anfrage eingeht.";
