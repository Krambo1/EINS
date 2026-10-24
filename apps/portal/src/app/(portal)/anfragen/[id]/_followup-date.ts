import { berlinDateString } from "@/lib/formatting";

export const FOLLOWUP_DATE_MISSING = "Bitte wählen Sie Datum und Uhrzeit der Wiedervorlage.";
export const FOLLOWUP_DATE_PAST =
  "Das Datum der Wiedervorlage liegt in der Vergangenheit. Bitte wählen Sie heute oder einen späteren Tag.";

/**
 * V7 3.9: a Wiedervorlage may be due today (also at an earlier hour, e.g. to
 * keep a callback on today's list) or later, never on a past calendar day.
 * Both sides are compared as Berlin calendar days.
 */
export function isPastBerlinDay(dueAt: Date, now: Date = new Date()): boolean {
  return berlinDateString(dueAt) < berlinDateString(now);
}

/**
 * Same check on the raw `datetime-local` value for the dialog, before the
 * request goes out. The value's date part is already Berlin wall-clock time.
 */
export function followupInputError(value: string, now: Date = new Date()): string | null {
  const v = value.trim();
  if (!v) return FOLLOWUP_DATE_MISSING;
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(v)?.[1];
  if (day && day < berlinDateString(now)) return FOLLOWUP_DATE_PAST;
  return null;
}
