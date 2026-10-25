import type { DashboardRange } from "@/lib/dashboard-range";

/** Short names on the page-level switch. */
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
