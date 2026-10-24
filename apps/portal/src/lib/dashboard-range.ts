import { DAY_MS } from "./constants";

export const DASHBOARD_RANGES = [
  "heute",
  "mon",
  "jahr",
  "max",
] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "mon";

/** URL search-param keys for each dashboard card with its own range toggle. */
export const DASHBOARD_RANGE_KEYS = {
  leads: "rLeads",
  revenue: "rRevenue",
  open: "rOpen",
  total: "rTotal",
  sources: "rSources",
  funnel: "rFunnel",
  locations: "rLocations",
  treatments: "rTreatments",
  noShow: "rNoShow",
} as const;

/** URL search-param keys for each admin Übersicht chart card with its own
 *  range toggle. Reuses DASHBOARD_RANGES / parseDashboardRange / dashboardRangeDays
 *  so the admin switchers behave identically to the clinic ones. */
export const ADMIN_RANGE_KEYS = {
  perf: "rPerf",
  pipeline: "rPipeline",
  ai: "rAi",
  leistung: "rLeistung",
} as const;

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  heute: "Heute",
  mon: "Monat",
  jahr: "Jahr",
  max: "Max",
};

const RANGE_DAYS: Record<DashboardRange, number> = {
  heute: 1,
  mon: 30,
  jahr: 365,
  max: 1825,
};

export function parseDashboardRange(value: unknown): DashboardRange {
  if (
    typeof value === "string" &&
    (DASHBOARD_RANGES as readonly string[]).includes(value)
  ) {
    return value as DashboardRange;
  }
  return DEFAULT_DASHBOARD_RANGE;
}

export function dashboardRangeDays(range: DashboardRange): number {
  return RANGE_DAYS[range];
}

// ---------------------------------------------------------------------------
// Berlin calendar days. Every Praxis is in DACH, the server runs in UTC, so
// "heute", "letzter Monat" etc. are Berlin calendar days, not server days.
// Kept dependency-free (this module is also imported by a client component).
// ---------------------------------------------------------------------------

const BERLIN_TZ = "Europe/Berlin";

const berlinPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Berlin wall-clock time of `d`, encoded as if it were UTC milliseconds. */
function berlinWallMs(d: Date): number {
  const p: Record<string, number> = {};
  for (const part of berlinPartsFormatter.formatToParts(d)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** Berlin calendar date ("YYYY-MM-DD") of an instant. */
export function berlinDay(d: Date = new Date()): string {
  return new Date(berlinWallMs(d)).toISOString().slice(0, 10);
}

/** Hour of day (0-23) in Berlin. */
export function berlinHour(d: Date = new Date()): number {
  return new Date(berlinWallMs(d)).getUTCHours();
}

/** "YYYY-MM-DD" shifted by `n` calendar days. */
export function addIsoDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Instant of 00:00 Berlin on the given calendar day (DST-safe). */
export function berlinStartOfDay(iso: string): Date {
  const wall = Date.parse(`${iso}T00:00:00Z`);
  // Midnight is never inside a Berlin DST gap (switches happen at 02:00 /
  // 03:00), so the offset at the guessed instant converges in <= 2 steps.
  let guess = wall - 3_600_000;
  for (let i = 0; i < 3; i++) {
    const next = wall - (berlinWallMs(new Date(guess)) - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export interface DashboardWindow {
  /** 00:00 Berlin on the first day (inclusive). */
  from: Date;
  /** 23:59:59.999 Berlin on the last day (inclusive). */
  to: Date;
  /** Calendar days in the window. */
  days: number;
  /** Berlin calendar date of `from` ("YYYY-MM-DD"). */
  fromDate: string;
  /** Berlin calendar date of `to` ("YYYY-MM-DD"). */
  toDate: string;
}

/** Window of whole Berlin calendar days [fromDate, toDate]. */
export function berlinDayWindow(fromDate: string, toDate: string): DashboardWindow {
  const from = berlinStartOfDay(fromDate);
  const to = new Date(berlinStartOfDay(addIsoDays(toDate, 1)).getTime() - 1);
  const days =
    Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS) + 1;
  return { from, to, days, fromDate, toDate };
}

export function dashboardRangeWindow(
  range: DashboardRange,
  now: Date = new Date()
): DashboardWindow {
  const days = RANGE_DAYS[range];
  const today = berlinDay(now);
  return berlinDayWindow(addIsoDays(today, -(days - 1)), today);
}

/**
 * The same number of calendar days immediately before `win` (comparison
 * period). Computed in days, not milliseconds, so a window that spans a DST
 * switch (23 or 25 hour day) still yields whole Berlin days.
 */
export function priorDashboardWindow(win: {
  fromDate: string;
  days: number;
}): DashboardWindow {
  const priorTo = addIsoDays(win.fromDate, -1);
  return berlinDayWindow(addIsoDays(priorTo, -(win.days - 1)), priorTo);
}

/**
 * Monthly goals are scaled linearly to the selected window (30-day target
 * × windowDays / 30). When a Praxis joined EINS partway through that
 * window — e.g. 3 months ago but Jahr is selected — the unscaled compare
 * yields a target the clinic literally had no chance to hit, falsely
 * flagging "Redebedarf". This caps the scaling at the number of days the
 * clinic has actually existed, so the goal ratio reflects the time
 * available to hit it.
 *
 * Returns `capped: true` when the clinic is younger than the window, so
 * callers can surface a small explanation in the UI.
 */
export function effectiveScalingDays(
  win: { days: number },
  clinicCreatedAt: Date | string | null | undefined,
  now: Date = new Date()
): { days: number; capped: boolean } {
  if (!clinicCreatedAt) return { days: win.days, capped: false };
  // unstable_cache can re-hydrate a Date prop as an ISO string across HMR /
  // RSC payload boundaries — accept both rather than assume a Date instance.
  const createdAt =
    clinicCreatedAt instanceof Date
      ? clinicCreatedAt
      : new Date(clinicCreatedAt);
  const elapsedMs = now.getTime() - createdAt.getTime();
  const elapsedDays = Math.max(1, Math.ceil(elapsedMs / (1000 * 60 * 60 * 24)));
  if (elapsedDays >= win.days) {
    return { days: win.days, capped: false };
  }
  return { days: elapsedDays, capped: true };
}

/**
 * German short label for "the Praxis has been with EINS for X" — used in
 * the capped-goal hint. Picks the coarsest unit that still reads naturally:
 * < 14 days → "X Tagen", < 9 weeks → "X Wochen", otherwise "X Monaten".
 */
export function formatRelationshipDurationDe(days: number): string {
  const d = Math.max(1, Math.round(days));
  if (d < 14) return `${d} ${d === 1 ? "Tag" : "Tagen"}`;
  if (d < 63) {
    const weeks = Math.round(d / 7);
    return `${weeks} ${weeks === 1 ? "Woche" : "Wochen"}`;
  }
  const months = Math.round(d / 30);
  return `${months} ${months === 1 ? "Monat" : "Monaten"}`;
}
