import { DAY_MS, type TimelineStatus } from "@/lib/constants";
import { berlinDateString, formatDate } from "@/lib/formatting";

/**
 * Date words on a Fortschritt card (DN1). "Heute" only on the same Berlin
 * calendar day; a planned date in the past says "Geplant seit <Datum>"
 * instead of "Heute geplant".
 */

/** Calendar days from `ref` to `date` in Berlin wall time (UTC server). */
export function berlinDaysBetween(date: Date, ref: Date): number {
  const a = Date.parse(berlinDateString(date));
  const b = Date.parse(berlinDateString(ref));
  return Math.round((a - b) / DAY_MS);
}

function inDays(d: number): string {
  if (d === 1) return "Morgen";
  if (d < 14) return `In ${d} Tagen`;
  if (d < 60) return `In ${Math.round(d / 7)} Wochen`;
  return `In ${Math.round(d / 30)} Monaten`;
}

/**
 * The parts after the status word, joined with " · " by the card.
 * Most cases: relative words plus the date; past-due or odd cases name the
 * date inside one phrase.
 */
export function dateParts(status: TimelineStatus, date: Date, now: Date): string[] {
  const shown = formatDate(date);
  const ahead = berlinDaysBetween(date, now);
  if (status === "geplant") {
    if (ahead < 0) return [`Geplant seit ${shown}`];
    if (ahead === 0) return ["Heute geplant", shown];
    return [inDays(ahead), shown];
  }
  if (status === "laeuft") {
    if (ahead > 0) return [`Geplant ab ${shown}`];
    const since = -ahead;
    if (since === 0) return ["Heute gestartet", shown];
    if (since === 1) return ["Seit gestern aktiv", shown];
    if (since < 14) return [`Seit ${since} Tagen aktiv`, shown];
    if (since < 60) return [`Seit ${Math.round(since / 7)} Wochen aktiv`, shown];
    return [`Seit ${Math.round(since / 30)} Monaten aktiv`, shown];
  }
  const ago = -ahead;
  if (ago < 0) return [shown];
  if (ago === 0) return ["Heute erledigt", shown];
  if (ago === 1) return ["Gestern erledigt", shown];
  if (ago < 14) return [`Vor ${ago} Tagen`, shown];
  if (ago < 60) return [`Vor ${Math.round(ago / 7)} Wochen`, shown];
  return [`Vor ${Math.round(ago / 30)} Monaten`, shown];
}

/** Recommendations ("Empfehlung: ...") are hints, not steps of the plan. */
export function isRecommendation(title: string): boolean {
  return /^Empfehlung\b/i.test(title.trim());
}

/** A step of the journey plan: date-less, with a phase label, no recommendation. */
export function isPhaseStep(e: {
  title: string;
  eventDate: Date | null;
  phaseLabel: string | null;
}): boolean {
  return !e.eventDate && !!e.phaseLabel && !isRecommendation(e.title);
}
