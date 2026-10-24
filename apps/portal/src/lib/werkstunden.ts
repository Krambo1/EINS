/**
 * Werkstunden for the 48-hour response rule (KANON section 6a, Garantie-Anhang
 * v2.1 § 2 Abs. (9), § 6 Abs. (4) to (7)). Pure: no DB, no clock reads.
 *
 * Werkstunde: every hour Monday to Friday from 09:00 to 18:00 Europe/Berlin,
 * except statutory holidays at the seat of the Praxis. An inquiry that arrives
 * outside working hours starts its clock at the next working hour.
 *
 * Holidays: the seat of the Praxis is not stored in the portal, so the
 * response deadline skips the UNION of the statutory holidays of all 16
 * Länder. That is deliberately conservative: an extra skipped day only moves
 * the computed deadline later, never earlier than the contractual one, so the
 * portal never flags a Praxis too early.
 *
 * Werktag (Folge 3, cure period after a warning) follows the Garantie-Anhang
 * definition instead: Monday to Friday except nationwide holidays and the
 * holidays at the seat of EINS (Köln, NRW).
 *
 * All arithmetic runs on Berlin wall-clock time ("wall ms": the local date
 * and time encoded as if it were UTC) and converts back to an instant only at
 * the end, so the DST switches never shift a deadline. Working hours never
 * touch the 02:00 to 03:00 gap, and midnight is never ambiguous, so the
 * conversion back is always unique.
 */

import { addDays, fromDayNumber, toDayNumber, type IsoDate } from "./guarantee-clock";
import { DAY_MS } from "./constants";

export const RESPONSE_WORKING_HOURS = 48;
export const WORKDAY_START_HOUR = 9;
export const WORKDAY_END_HOUR = 18;

const HOUR_MS = 3_600_000;
const START_MS = WORKDAY_START_HOUR * HOUR_MS;
const END_MS = WORKDAY_END_HOUR * HOUR_MS;

// ---------------------------------------------------------------------------
// Berlin wall clock
// ---------------------------------------------------------------------------

const berlinParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Berlin local date and time of `ts`, encoded as UTC milliseconds. */
export function berlinWallMs(ts: Date): number {
  const p: Record<string, number> = {};
  for (const part of berlinParts.formatToParts(ts)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return (
    Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) +
    (ts.getTime() % 1000 + 1000) % 1000
  );
}

/** Inverse of `berlinWallMs` for times that exist exactly once in Berlin. */
export function instantFromBerlinWall(wall: number): Date {
  let guess = wall - HOUR_MS; // CET as a first guess
  for (let i = 0; i < 3; i++) {
    const offset = berlinWallMs(new Date(guess)) - guess;
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Instant of 00:00 Berlin time on the given calendar day. */
export function berlinMidnight(day: IsoDate): Date {
  return instantFromBerlinWall(toDayNumber(day) * DAY_MS);
}

/** 1970-01-01 was a Thursday. 0 = Sunday ... 6 = Saturday. */
function weekday(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

/** Easter Sunday (Gregorian computus, anonymous algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function iso(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Holidays in every Land. */
function nationwideHolidays(year: number): IsoDate[] {
  const easter = easterSunday(year);
  return [
    iso(year, 1, 1), // Neujahr
    addDays(easter, -2), // Karfreitag
    addDays(easter, 1), // Ostermontag
    iso(year, 5, 1), // Tag der Arbeit
    addDays(easter, 39), // Christi Himmelfahrt
    addDays(easter, 50), // Pfingstmontag
    iso(year, 10, 3), // Tag der Deutschen Einheit
    iso(year, 12, 25), // 1. Weihnachtstag
    iso(year, 12, 26), // 2. Weihnachtstag
  ];
}

/** Buß- und Bettag: the Wednesday before 23 November (16 to 22 November). */
function bussUndBettag(year: number): IsoDate {
  for (let day = 16; day <= 22; day++) {
    const date = iso(year, 11, day);
    if (weekday(toDayNumber(date)) === 3) return date;
  }
  throw new Error("unreachable");
}

/** Holidays that only some Länder (or one city) observe. */
function regionalHolidays(year: number): IsoDate[] {
  const easter = easterSunday(year);
  return [
    iso(year, 1, 6), // Heilige Drei Könige (BW, BY, ST)
    iso(year, 3, 8), // Internationaler Frauentag (BE, MV)
    addDays(easter, 60), // Fronleichnam (BW, BY, HE, NW, RP, SL, teils SN, TH)
    iso(year, 8, 8), // Augsburger Friedensfest (Stadt Augsburg)
    iso(year, 8, 15), // Mariä Himmelfahrt (SL, teils BY)
    iso(year, 9, 20), // Weltkindertag (TH)
    iso(year, 10, 31), // Reformationstag (BB, HB, HH, MV, NI, SN, ST, SH, TH)
    iso(year, 11, 1), // Allerheiligen (BW, BY, NW, RP, SL)
    bussUndBettag(year), // Buß- und Bettag (SN)
  ];
}

/** NRW-only additions on top of the nationwide holidays (seat of EINS). */
function nrwHolidays(year: number): IsoDate[] {
  const easter = easterSunday(year);
  return [
    addDays(easter, 60), // Fronleichnam
    iso(year, 11, 1), // Allerheiligen
  ];
}

const unionCache = new Map<number, ReadonlySet<IsoDate>>();
const nrwCache = new Map<number, ReadonlySet<IsoDate>>();

function unionHolidaySet(year: number): ReadonlySet<IsoDate> {
  let set = unionCache.get(year);
  if (!set) {
    set = new Set([...nationwideHolidays(year), ...regionalHolidays(year)]);
    unionCache.set(year, set);
  }
  return set;
}

function nrwHolidaySet(year: number): ReadonlySet<IsoDate> {
  let set = nrwCache.get(year);
  if (!set) {
    set = new Set([...nationwideHolidays(year), ...nrwHolidays(year)]);
    nrwCache.set(year, set);
  }
  return set;
}

/** Statutory holiday in at least one Land (used for the response deadline). */
export function isAnyStatutoryHoliday(day: IsoDate): boolean {
  return unionHolidaySet(Number(day.slice(0, 4))).has(day);
}

/** Nationwide or NRW holiday (used for the Werktag of Folge 3). */
export function isNrwHoliday(day: IsoDate): boolean {
  return nrwHolidaySet(Number(day.slice(0, 4))).has(day);
}

function isWorkingDay(dayNumber: number): boolean {
  const wd = weekday(dayNumber);
  return wd >= 1 && wd <= 5 && !isAnyStatutoryHoliday(fromDayNumber(dayNumber));
}

function nextWorkingDay(dayNumber: number): number {
  let d = dayNumber + 1;
  while (!isWorkingDay(d)) d++;
  return d;
}

/** Werktag per Garantie-Anhang: Mon to Fri without nationwide and NRW holidays. */
export function isWerktag(day: IsoDate): boolean {
  const wd = weekday(toDayNumber(day));
  return wd >= 1 && wd <= 5 && !isNrwHoliday(day);
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/**
 * The instant `hours` Werkstunden after `start`. A start outside working
 * hours is first moved to the next working hour. A deadline that lands
 * exactly on 18:00 stays on that day (it does not roll to 09:00 next day).
 */
export function addWorkingHours(start: Date, hours: number): Date {
  const wall = berlinWallMs(start);
  let day = Math.floor(wall / DAY_MS);
  let t = wall - day * DAY_MS;
  if (!isWorkingDay(day) || t >= END_MS) {
    day = nextWorkingDay(day);
    t = START_MS;
  } else if (t < START_MS) {
    t = START_MS;
  }

  let remaining = Math.max(0, hours) * HOUR_MS;
  for (;;) {
    const available = END_MS - t;
    if (remaining <= available) return instantFromBerlinWall(day * DAY_MS + t + remaining);
    remaining -= available;
    day = nextWorkingDay(day);
    t = START_MS;
  }
}

/** End of the 48-Werkstunden window for an inquiry that arrived at `createdAt`. */
export function responseDeadline(createdAt: Date): Date {
  return addWorkingHours(createdAt, RESPONSE_WORKING_HOURS);
}

/** The Werktag after the Berlin calendar day of `ts`. */
export function nextWerktag(ts: Date): IsoDate {
  let day = addDays(fromDayNumber(Math.floor(berlinWallMs(ts) / DAY_MS)), 1);
  while (!isWerktag(day)) day = addDays(day, 1);
  return day;
}

/**
 * End of the Werktag after `ts` (24:00 Berlin, returned as the instant of the
 * following midnight). Folge 3: if three or more inquiries are still overdue
 * at this moment after a warning, EINS may pause paid ads.
 */
export function endOfNextWerktag(ts: Date): Date {
  return berlinMidnight(addDays(nextWerktag(ts), 1));
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const berlinDateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "12.10.2026, 13:00" in Berlin time, independent of the server time zone. */
export function formatBerlinDateTime(ts: Date | null | undefined): string {
  if (!ts || Number.isNaN(ts.getTime())) return "–";
  return berlinDateTimeFormatter.format(ts);
}
