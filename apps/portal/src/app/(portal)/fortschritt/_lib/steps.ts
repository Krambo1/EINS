import { DAY_MS, type TimelineStatus } from "@/lib/constants";
import { berlinDateString } from "@/lib/formatting";
import {
  currentJourneyWeek,
  effectiveStatus,
  journeyStart,
  parsePhaseWeeks,
} from "../_components/journey-status";
import { dateParts } from "../_components/timeline-labels";

/**
 * What the Fortschritt page shows, as plain data: the week of the journey and
 * the steps of the three cards, each with its title, one meta line and the
 * description that opens on tap. Pure, so the page and the tests share it.
 */

export interface StepRow {
  id: string;
  title: string;
  description: string | null;
  /** The meta line's parts, joined by a middle dot. */
  meta: string[];
}

export interface FortschrittView {
  /** Week of the relative-phase journey, null without one (dated entries only). */
  week: number | null;
  active: StepRow[];
  upcoming: StepRow[];
  done: StepRow[];
}

type Entry = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  eventDate: Date | null;
  phaseLabel: string | null;
  sortOrder: number;
  createdAt: Date;
};

/** Berlin calendar day of `d` as UTC midnight, so day counts ignore DST. */
const berlinDay = (d: Date) => Date.parse(berlinDateString(d));

/**
 * Where a relative phase stands (DESIGN-CRITIQUE: "relative Phasen zeigen nur
 * 'Woche 1 bis 2', keinen Stand"). Counted in Berlin days from the journey
 * start, the week window of the label being days (from-1)*7 up to to*7.
 * Planned: when it starts ("In 4 Tagen"); running with an end: what is left
 * ("Noch 9 Tage", "Endet morgen"); running without an end ("Ab Woche 2"):
 * since when, in the DN1 words. Null for done phases, labels without a week
 * window ("Laufend") and without a start.
 */
export function phaseStand(
  status: TimelineStatus,
  phaseLabel: string | null,
  start: Date | null,
  now: Date
): string | null {
  const weeks = parsePhaseWeeks(phaseLabel);
  if (!weeks || !start || status === "abgeschlossen") return null;
  const day0 = berlinDay(start);
  const today = Math.round((berlinDay(now) - day0) / DAY_MS);
  const opens = new Date(day0 + (weeks.from - 1) * 7 * DAY_MS);
  if (status === "geplant") {
    return today < (weeks.from - 1) * 7 ? dateParts("geplant", opens, now)[0]! : null;
  }
  if (weeks.to === Infinity) return dateParts("laeuft", opens, now)[0]!;
  const left = weeks.to * 7 - today;
  if (left <= 0) return null;
  if (left === 1) return "Endet heute";
  if (left === 2) return "Endet morgen";
  if (left < 14) return `Noch ${left} Tage`;
  return `Noch ${Math.round(left / 7)} Wochen`;
}

/**
 * Order inside a card: dated entries by date (`dateDir` -1 newest first, 1
 * soonest first), date-less phase steps by `sortOrder` (`planDir` 1 in plan
 * order, -1 from the last step back); in a mixed card the dated entries
 * come first.
 */
function compare(dateDir: 1 | -1, planDir: 1 | -1) {
  return (a: Entry, b: Entry): number => {
    const at = a.eventDate ? a.eventDate.getTime() : null;
    const bt = b.eventDate ? b.eventDate.getTime() : null;
    if (at !== null && bt !== null) return (at - bt) * dateDir;
    if (at === null && bt === null) return (a.sortOrder - b.sortOrder) * planDir;
    return at === null ? 1 : -1;
  };
}

export function buildFortschritt(entries: Entry[], now: Date): FortschrittView {
  // Relative phases get their state from the calendar: the journey starts
  // the day it was set up for this Praxis.
  const start = journeyStart(entries);
  const week = start ? currentJourneyWeek(start, now) : null;

  const row = (e: Entry, status: TimelineStatus): StepRow => {
    let meta: string[];
    if (e.eventDate) meta = dateParts(status, e.eventDate, now);
    else if (e.phaseLabel) {
      const stand = phaseStand(status, e.phaseLabel, start, now);
      meta = stand ? [e.phaseLabel, stand] : [e.phaseLabel];
    } else meta = ["Ohne Datum"];
    return { id: e.id, title: e.title, description: e.description?.trim() || null, meta };
  };

  const pick = (status: TimelineStatus, dateDir: 1 | -1, planDir: 1 | -1) =>
    entries
      // Anything not running or done counts as planned, including a status
      // value this page does not know (effectiveStatus maps it to
      // "geplant"), so no entry ever silently disappears.
      .filter((e) => effectiveStatus(e, week) === status)
      .sort(compare(dateDir, planDir))
      .map((e) => row(e, status));

  return {
    week,
    active: pick("laeuft", -1, 1),
    upcoming: pick("geplant", 1, 1),
    // Newest first: the latest dated entries, then the finished phases from
    // the last one back to the first.
    done: pick("abgeschlossen", -1, -1),
  };
}
