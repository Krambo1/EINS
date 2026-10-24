/**
 * German PVS systems store wall-clock times WITHOUT a zone: a GDT 6200/6201
 * pair, a Firebird TIMESTAMP, a "07.10.2026 14:30" CSV cell all mean
 * Europe/Berlin local time. tz-pin.ts pins the process to UTC, so a naive
 * `new Date(y, m, d, h)` or `...T14:30:00Z` would label Berlin wall-clock
 * as UTC and shift every event 1 h (winter) or 2 h (summer) into the future.
 *
 * This module converts Berlin wall-clock components to a real UTC instant
 * using the ICU tz database shipped with Node (no dependency on the host's
 * Windows time-zone setting, which may be wrong on a Praxis PC).
 *
 * DST edge cases:
 *   - Spring-forward gap (02:00-02:59 on the last Sunday in March does not
 *     exist): resolved to the instant one hour later, the same way a wall
 *     clock that was never set back would read.
 *   - Fall-back overlap (02:00-02:59 on the last Sunday in October exists
 *     twice): resolved to the FIRST occurrence (CEST). Deterministic, so
 *     re-reading the same source value always yields the same instant.
 */

export const PRAXIS_TIME_ZONE = "Europe/Berlin";

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PRAXIS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Offset of Europe/Berlin from UTC at `utcMs`, in minutes (60 or 120). */
function berlinOffsetMinutes(utcMs: number): number {
  const parts = offsetFormatter.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * Epoch ms of the Berlin wall-clock time (month is 1-based). Returns null for
 * components that do not form a real calendar date/time.
 */
export function berlinWallClockToUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two-pass offset resolution. First guess with the offset at the naive
  // instant, then re-check with the offset at the corrected instant. In the
  // fall-back overlap both passes agree on the CEST (+120) reading because we
  // try the larger offset first; in the spring gap the second pass lands an
  // hour later, which is the documented resolution.
  const candidates = [120, 60].map((off) => naiveUtc - off * 60_000);
  for (const utc of candidates) {
    if (berlinOffsetMinutes(utc) * 60_000 === naiveUtc - utc) return utc;
  }
  // Spring-forward gap: no instant reads as this wall clock. Use the winter
  // offset, which maps 02:30 to 03:30 CEST.
  return naiveUtc - 60 * 60_000;
}

/** ISO-8601 UTC string for a Berlin wall-clock time, or undefined. */
export function berlinWallClockToUtcIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string | undefined {
  const ms = berlinWallClockToUtcMs(year, month, day, hour, minute, second);
  return ms === null ? undefined : new Date(ms).toISOString();
}

/**
 * A date WITHOUT a time of day (GDT TTMMJJJJ, a "Zahldatum" CSV cell) is
 * anchored at 12:00 Berlin. Midnight would map to 22:00/23:00 UTC of the
 * PREVIOUS day and move the event into the wrong day (and, on the 1st, the
 * wrong month) in any UTC-bucketed report. Noon stays on the same calendar
 * day in both Berlin and UTC all year.
 */
export function berlinDateToUtcIso(
  year: number,
  month: number,
  day: number
): string | undefined {
  return berlinWallClockToUtcIso(year, month, day, 12, 0, 0);
}

/**
 * Re-interpret a JS Date that a database driver built from a zone-less
 * TIMESTAMP while the process TZ is UTC (tz-pin.ts): its UTC fields ARE the
 * Berlin wall-clock fields. Returns the real instant.
 */
export function naiveUtcDateAsBerlin(d: Date): Date | null {
  if (Number.isNaN(d.getTime())) return null;
  const ms = berlinWallClockToUtcMs(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  );
  return ms === null ? null : new Date(ms + d.getUTCMilliseconds());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
