import { berlinDateString } from "@/lib/formatting";

/**
 * Berlin calendar-day helpers for the nightly jobs. Production runs in UTC
 * (Vercel, Fly), so "gestern" and "Vormonat" must be derived from the Berlin
 * wall clock, never from `toISOString()`.
 *
 * Pure functions over "YYYY-MM-DD" strings; safe in the worker and in routes.
 */

/** Shift a "YYYY-MM-DD" calendar day by `n` days (calendar math, no TZ). */
export function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y!, m! - 1, d! + n);
  return new Date(t).toISOString().slice(0, 10);
}

/** Today's Berlin calendar date. */
export function berlinToday(now: Date = new Date()): string {
  return berlinDateString(now);
}

/** Yesterday's Berlin calendar date. */
export function berlinYesterday(now: Date = new Date()): string {
  return addDaysIso(berlinDateString(now), -1);
}

/** "YYYY-MM" of the Berlin calendar month before the one `now` falls in. */
export function previousBerlinMonth(now: Date = new Date()): string {
  const [y, m] = berlinDateString(now).split("-").map(Number);
  const py = m === 1 ? y! - 1 : y!;
  const pm = m === 1 ? 12 : m! - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

const berlinClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * Patient mail send window (E-12): Monday to Friday, 09:00 to 17:59 Berlin.
 * Outside it the review tick leaves rows pending for the next window.
 */
export function isPatientMailWindow(now: Date = new Date()): boolean {
  const parts = berlinClock.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour >= 9 && hour < 18;
}

/** Strict "YYYY-MM" check (month 01..12). */
export function isYearMonth(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** Strict "YYYY-MM-DD" check. */
export function isIsoDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return addDaysIso(v, 0) === v;
}
