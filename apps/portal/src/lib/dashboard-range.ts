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
} as const;

export type DashboardRangeKey =
  (typeof DASHBOARD_RANGE_KEYS)[keyof typeof DASHBOARD_RANGE_KEYS];

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  heute: "Heute",
  mon: "Mon",
  jahr: "Jahr",
  max: "Max",
};

export const DASHBOARD_RANGE_FULL_LABELS: Record<DashboardRange, string> = {
  heute: "heute",
  mon: "letzter Monat",
  jahr: "letztes Jahr",
  max: "Gesamter Zeitraum",
};

export const DASHBOARD_RANGE_COMPARISON_HINTS: Record<DashboardRange, string> = {
  heute: "vs. gestern",
  mon: "vs. Vormonat",
  jahr: "vs. Vorjahr",
  max: "Gesamt",
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

export function dashboardRangeWindow(
  range: DashboardRange,
  now: Date = new Date()
): { from: Date; to: Date; days: number } {
  const days = RANGE_DAYS[range];
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return { from, to, days };
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
