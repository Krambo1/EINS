import { DAY_MS } from "@/lib/constants";
import type { TimelineStatus } from "@/lib/constants";
import { berlinDateString } from "@/lib/formatting";

/**
 * Where a Praxis stands in its relative-phase journey ("Woche 1 bis 2", ...).
 * Pure functions over data the Fortschritt page already loads: the start is
 * the day the journey was set up for this Praxis (earliest `createdAt` of the
 * date-less phase entries), the current week counts from there.
 */

/** Inclusive week range of a phase label; `to` = Infinity for "Ab Woche N". */
export interface PhaseWeeks {
  from: number;
  to: number;
}

/**
 * Parse the phase labels the default journey uses. Labels without a time
 * window ("Erste qualifizierte Anfrage", "Laufend", "Monatlich") return null:
 * their state comes from the status EINS sets, not from the calendar.
 */
export function parsePhaseWeeks(label: string | null | undefined): PhaseWeeks | null {
  if (!label) return null;
  const t = label.trim();
  let m = /^Woche (\d+) bis (\d+)$/i.exec(t);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  m = /^Ab Woche (\d+)$/i.exec(t);
  if (m) return { from: Number(m[1]), to: Infinity };
  m = /^Woche (\d+)$/i.exec(t);
  if (m) return { from: Number(m[1]), to: Number(m[1]) };
  m = /^Tag (\d+)$/i.exec(t);
  if (m) {
    const w = Math.max(1, Math.ceil(Number(m[1]) / 7));
    return { from: w, to: w };
  }
  m = /^Nach (\d+) Tagen$/i.exec(t);
  if (m) {
    const w = Math.floor(Number(m[1]) / 7) + 1;
    return { from: w, to: w };
  }
  if (/^Zum Start$/i.test(t)) return { from: 1, to: 1 };
  return null;
}

/** Week number (1-based) of `now` since `start`, in Berlin calendar days. */
export function currentJourneyWeek(start: Date, now: Date): number {
  const days = Math.round(
    (Date.parse(berlinDateString(now)) - Date.parse(berlinDateString(start))) / DAY_MS
  );
  return Math.max(0, Math.floor(days / 7)) + 1;
}

/**
 * Display status of one entry. "abgeschlossen" set by EINS always wins (a
 * step can finish early). Otherwise a phase with a week window follows the
 * calendar; everything else (dated entries, phases without a window) keeps
 * the status EINS set.
 */
export function effectiveStatus(
  entry: { status: string; eventDate: Date | null; phaseLabel: string | null },
  week: number | null
): TimelineStatus {
  const stored: TimelineStatus =
    entry.status === "laeuft" || entry.status === "abgeschlossen"
      ? entry.status
      : "geplant";
  if (stored === "abgeschlossen") return stored;
  if (entry.eventDate || week == null) return stored;
  const phase = parsePhaseWeeks(entry.phaseLabel);
  if (!phase) return stored;
  if (week < phase.from) return "geplant";
  if (week > phase.to) return "abgeschlossen";
  return "laeuft";
}

/** Earliest `createdAt` of the date-less phase entries, or null. */
export function journeyStart(
  entries: { eventDate: Date | null; phaseLabel: string | null; createdAt: Date }[]
): Date | null {
  let start: Date | null = null;
  for (const e of entries) {
    if (e.eventDate || !e.phaseLabel) continue;
    if (!start || e.createdAt < start) start = e.createdAt;
  }
  return start;
}
