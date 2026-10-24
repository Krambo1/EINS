/**
 * Wiederbehandlungs-Kalender: pure rules. No DB, no I/O, no clock reads
 * (callers pass `today`), so every rule is unit-testable.
 *
 * Vocabulary:
 *   visit  = one completed PVS encounter (EncounterCompleted), as a
 *            Europe/Berlin calendar day
 *   cycle  = one session plus any touch-up within TOUCH_UP_WINDOW_DAYS of
 *            its first day (a Botox touch-up two weeks later is not a new
 *            session)
 *   gap    = days between the first days of two consecutive cycles of the
 *            same patient and treatment
 *
 * The interval per treatment is either the Praxis's own setting (mode
 * 'fixed') or the median gap in the Praxis's PVS history (mode 'auto'). With
 * too little history the treatment stays out of the calendar: we never
 * invent a default interval.
 *
 * Days are ISO strings ('YYYY-MM-DD'). Arithmetic runs on UTC midnight so
 * DST never shifts a date.
 */

export const TOUCH_UP_WINDOW_DAYS = 30;
/** Gaps longer than this are a lapsed patient coming back, not a rhythm. */
export const MAX_GAP_DAYS = 1095;
/** Minimum repeat gaps before a PVS interval counts. */
export const MIN_GAPS = 5;
/** Minimum distinct patients behind those gaps. */
export const MIN_PATIENTS = 3;
/** Reminder goes out this many days before the due date. */
export const REMINDER_LEAD_DAYS = 14;
/** A row more overdue than this never gets a first reminder. */
export const REMINDER_MAX_OVERDUE_DAYS = 60;
/** No second reminder to the same patient within this many days. */
export const REMINDER_COOLDOWN_DAYS = 30;
/** Window of the "Fällig in den nächsten 90 Tagen" forecast. */
export const FORECAST_WINDOW_DAYS = 90;

export type RetreatmentMode = "auto" | "fixed" | "off";
export const RETREATMENT_MODES: readonly RetreatmentMode[] = ["auto", "fixed", "off"];
export type IntervalSource = "fixed" | "pvs";
export type CycleStatus = "open" | "booked" | "returned" | "dismissed";
export type ReminderStatus = "pending" | "sent" | "skipped" | "not_needed";
export type ReminderSkipReason =
  | "too_old"
  | "no_email"
  | "unsubscribed"
  | "recently_reminded";

export const REMINDER_SKIP_REASON_LABELS: Record<ReminderSkipReason, string> = {
  too_old: "Fälligkeit lag zu weit zurück",
  no_email: "Keine E-Mail-Adresse",
  unsubscribed: "Hat sich abgemeldet",
  recently_reminded: "Kurz zuvor schon erinnert",
};

// ---------------------------------------------------------------------------
// Day arithmetic
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(day: string): number {
  if (!ISO_DAY.test(day)) throw new Error(`invalid day: ${day}`);
  return Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar day of `d` in Europe/Berlin (a 23:30 UTC visit is the next day locally). */
export function berlinDay(d: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** Calendar months; the day clamps to the end of a shorter month (31.01. + 1 = 28./29.02.). */
export function addMonths(day: string, n: number): string {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + n;
  const d = +day.slice(8, 10);
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(targetY, targetM, Math.min(d, lastDay)));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error("median of empty list");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export interface Cycle<T extends { day: string }> {
  /** First day of the cycle. */
  start: string;
  visits: T[];
}

/**
 * Group one patient's visits of ONE treatment into cycles. A visit within
 * TOUCH_UP_WINDOW_DAYS of the current cycle's first day joins that cycle.
 */
export function groupCycles<T extends { day: string }>(visits: readonly T[]): Cycle<T>[] {
  const sorted = [...visits].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const cycles: Cycle<T>[] = [];
  for (const v of sorted) {
    const current = cycles[cycles.length - 1];
    if (current && daysBetween(current.start, v.day) <= TOUCH_UP_WINDOW_DAYS) {
      current.visits.push(v);
    } else {
      cycles.push({ start: v.day, visits: [v] });
    }
  }
  return cycles;
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

export interface TreatmentVisit {
  /** Portal patient id, or a stable PVS-side key for unlinked patients. */
  patientKey: string;
  treatmentId: string;
  day: string;
}

export interface PvsInterval {
  /** Median gap in days. Null when there is too little history. */
  intervalDays: number | null;
  /** Number of repeat gaps seen (after dropping gaps over MAX_GAP_DAYS). */
  samples: number;
  /** Distinct patients contributing at least one gap. */
  patients: number;
}

/**
 * Median repeat interval per treatment from the Praxis's whole PVS history.
 * Every patient counts here (not only EINS patients): the interval is a
 * property of the treatment in this Praxis, and the more history the better.
 */
export function computePvsIntervals(visits: readonly TreatmentVisit[]): Map<string, PvsInterval> {
  const byTreatment = new Map<string, Map<string, TreatmentVisit[]>>();
  for (const v of visits) {
    let byPatient = byTreatment.get(v.treatmentId);
    if (!byPatient) byTreatment.set(v.treatmentId, (byPatient = new Map()));
    const list = byPatient.get(v.patientKey);
    if (list) list.push(v);
    else byPatient.set(v.patientKey, [v]);
  }

  const out = new Map<string, PvsInterval>();
  for (const [treatmentId, byPatient] of byTreatment) {
    const gaps: number[] = [];
    let patients = 0;
    for (const list of byPatient.values()) {
      const cycles = groupCycles(list);
      let contributed = false;
      for (let i = 1; i < cycles.length; i++) {
        const gap = daysBetween(cycles[i - 1].start, cycles[i].start);
        if (gap <= MAX_GAP_DAYS) {
          gaps.push(gap);
          contributed = true;
        }
      }
      if (contributed) patients += 1;
    }
    const enough = gaps.length >= MIN_GAPS && patients >= MIN_PATIENTS;
    out.set(treatmentId, {
      intervalDays: enough ? Math.round(median(gaps)) : null,
      samples: gaps.length,
      patients,
    });
  }
  return out;
}

export type ResolvedInterval =
  | { source: "fixed"; months: number }
  | { source: "pvs"; days: number };

export interface TreatmentIntervalSetting {
  mode: RetreatmentMode;
  intervalMonths: number | null;
  pvsIntervalDays: number | null;
}

/** Which interval applies to a treatment, or null when it stays out of the calendar. */
export function resolveInterval(t: TreatmentIntervalSetting): ResolvedInterval | null {
  if (t.mode === "off") return null;
  if (t.mode === "fixed") {
    return t.intervalMonths && t.intervalMonths > 0
      ? { source: "fixed", months: t.intervalMonths }
      : null;
  }
  return t.pvsIntervalDays && t.pvsIntervalDays > 0
    ? { source: "pvs", days: t.pvsIntervalDays }
    : null;
}

export function dueDateFor(cycleStart: string, interval: ResolvedInterval): string {
  return interval.source === "fixed"
    ? addMonths(cycleStart, interval.months)
    : addDays(cycleStart, interval.days);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface CycleInput {
  start: string;
  /** Netted invoices for the cycle; null when none were seen. */
  revenueCents: number | null;
}

export interface UpcomingAppointment {
  day: string;
  /** Portal treatment the appointment maps to; null when unknown or unmapped. */
  treatmentId: string | null;
}

export interface DerivedCycleRow {
  cycleOn: string;
  cycleRevenueCents: number | null;
  intervalDays: number;
  intervalSource: IntervalSource;
  dueOn: string;
  remindOn: string;
  status: "open" | "booked" | "returned";
  returnedOn: string | null;
  returnedRevenueCents: number | null;
  bookedFor: string | null;
  /** Initial reminder status for a NEW row. Existing rows keep theirs (see refresh). */
  reminderStatus: "pending" | "not_needed";
}

/**
 * Rows for one patient and one treatment. Every cycle but the last is
 * history ('returned', with the next cycle's day and revenue). The last
 * cycle is the live one: 'booked' when an upcoming appointment exists after
 * the touch-up window (same treatment or unknown treatment, so we never
 * remind someone who already has a date), otherwise 'open'.
 */
export function deriveCycleRows(input: {
  treatmentId: string;
  cycles: readonly CycleInput[];
  interval: ResolvedInterval;
  upcoming: readonly UpcomingAppointment[];
  today: string;
}): DerivedCycleRow[] {
  const cycles = [...input.cycles].sort((a, b) => (a.start < b.start ? -1 : 1));
  const rows: DerivedCycleRow[] = [];
  cycles.forEach((c, i) => {
    const dueOn = dueDateFor(c.start, input.interval);
    const base = {
      cycleOn: c.start,
      cycleRevenueCents: c.revenueCents,
      intervalDays: daysBetween(c.start, dueOn),
      intervalSource: input.interval.source,
      dueOn,
      remindOn: addDays(dueOn, -REMINDER_LEAD_DAYS),
    };
    const next = cycles[i + 1];
    if (next) {
      rows.push({
        ...base,
        status: "returned",
        returnedOn: next.start,
        returnedRevenueCents: next.revenueCents,
        bookedFor: null,
        reminderStatus: "not_needed",
      });
      return;
    }
    const earliestNext = addDays(c.start, TOUCH_UP_WINDOW_DAYS + 1);
    const booked = input.upcoming
      .filter(
        (a) =>
          a.day >= input.today &&
          a.day >= earliestNext &&
          (a.treatmentId === null || a.treatmentId === input.treatmentId)
      )
      .map((a) => a.day)
      .sort()[0];
    rows.push({
      ...base,
      status: booked ? "booked" : "open",
      returnedOn: null,
      returnedRevenueCents: null,
      bookedFor: booked ?? null,
      reminderStatus: "pending",
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Reminder decision
// ---------------------------------------------------------------------------

export type ReminderDecision =
  | { action: "send" }
  | { action: "skip"; reason: ReminderSkipReason }
  /** Leave pending: the Praxis has no booking path configured right now. */
  | { action: "wait" };

export function reminderDecision(input: {
  dueOn: string;
  today: string;
  email: string | null;
  suppressed: boolean;
  hasBookingPath: boolean;
  /** Last retreatment reminder to this patient (any treatment), if any. */
  lastReminderDay: string | null;
}): ReminderDecision {
  if (daysBetween(input.dueOn, input.today) > REMINDER_MAX_OVERDUE_DAYS) {
    return { action: "skip", reason: "too_old" };
  }
  if (!input.email || !input.email.includes("@")) return { action: "skip", reason: "no_email" };
  if (input.suppressed) return { action: "skip", reason: "unsubscribed" };
  if (
    input.lastReminderDay &&
    daysBetween(input.lastReminderDay, input.today) < REMINDER_COOLDOWN_DAYS
  ) {
    return { action: "skip", reason: "recently_reminded" };
  }
  if (!input.hasBookingPath) return { action: "wait" };
  return { action: "send" };
}

/** "etwa 3 Monate" / "etwa 6 Wochen", for the reminder body. */
export function sinceLastVisitPhrase(cycleOn: string, today: string): string {
  const days = Math.max(0, daysBetween(cycleOn, today));
  if (days < 60) {
    const weeks = Math.max(1, Math.round(days / 7));
    return weeks === 1 ? "etwa eine Woche" : `etwa ${weeks} Wochen`;
  }
  return `etwa ${Math.round(days / 30.44)} Monate`;
}

/** "ca. 4 Monate" / "ca. 10 Wochen", for the Praxis-facing interval column. */
export function intervalLabel(days: number): string {
  if (days < 60) return `ca. ${Math.round(days / 7)} Wochen`;
  const months = Math.round(days / 30.44);
  return months === 1 ? "ca. 1 Monat" : `ca. ${months} Monate`;
}

// ---------------------------------------------------------------------------
// Portal summaries
// ---------------------------------------------------------------------------

export interface SummaryRow {
  patientId: string;
  status: CycleStatus;
  dueOn: string;
  cycleRevenueCents: number | null;
  reminderSentAt: Date | null;
  returnedOn: string | null;
}

export interface ForecastSummary {
  /** Distinct patients with an open or booked row due in the next FORECAST_WINDOW_DAYS. */
  duePatients: number;
  dueRows: number;
  /** Sum of each row's last paid amount (what she paid for the same treatment last time). */
  dueValueCents: number;
  /** Due rows without a known last amount (not in dueValueCents). */
  dueRowsWithoutValue: number;
  /** Open rows already past their due date (not booked): the call list. */
  overduePatients: number;
}

export function summarizeForecast(rows: readonly SummaryRow[], today: string): ForecastSummary {
  const horizon = addDays(today, FORECAST_WINDOW_DAYS);
  const duePatients = new Set<string>();
  const overduePatients = new Set<string>();
  let dueRows = 0;
  let dueValueCents = 0;
  let dueRowsWithoutValue = 0;
  for (const r of rows) {
    if (r.status === "open" && r.dueOn < today) overduePatients.add(r.patientId);
    if ((r.status === "open" || r.status === "booked") && r.dueOn >= today && r.dueOn <= horizon) {
      duePatients.add(r.patientId);
      dueRows += 1;
      if (r.cycleRevenueCents && r.cycleRevenueCents > 0) dueValueCents += r.cycleRevenueCents;
      else dueRowsWithoutValue += 1;
    }
  }
  return {
    duePatients: duePatients.size,
    dueRows,
    dueValueCents,
    dueRowsWithoutValue,
    overduePatients: overduePatients.size,
  };
}

export interface ReminderSummary {
  /** Patients reminded on or after `monthStartDay` (Berlin calendar). */
  remindedThisMonth: number;
  /** Of those: now booked or already back. */
  bookedThisMonth: number;
  /** All time: patients reminded. */
  remindedTotal: number;
  /** All time: patients who came back for the treatment after their reminder. */
  returnedAfterReminder: number;
  /** All time: what those returns were paid, where the PVS sent an invoice. */
  returnedAfterReminderCents: number;
}

export function summarizeReminders(
  rows: readonly (SummaryRow & { returnedRevenueCents: number | null })[],
  /** First day of the current month, 'YYYY-MM-01', Europe/Berlin. */
  monthStartDay: string
): ReminderSummary {
  const remindedMonth = new Set<string>();
  const bookedMonth = new Set<string>();
  const remindedAll = new Set<string>();
  const returnedAll = new Set<string>();
  let returnedCents = 0;
  for (const r of rows) {
    if (!r.reminderSentAt) continue;
    remindedAll.add(r.patientId);
    const sentDay = berlinDay(r.reminderSentAt);
    const cameBack = r.status === "returned" && !!r.returnedOn && r.returnedOn >= sentDay;
    if (cameBack) {
      returnedAll.add(r.patientId);
      if (r.returnedRevenueCents && r.returnedRevenueCents > 0) returnedCents += r.returnedRevenueCents;
    }
    if (sentDay >= monthStartDay) {
      remindedMonth.add(r.patientId);
      if (r.status === "booked" || cameBack) bookedMonth.add(r.patientId);
    }
  }
  return {
    remindedThisMonth: remindedMonth.size,
    bookedThisMonth: bookedMonth.size,
    remindedTotal: remindedAll.size,
    returnedAfterReminder: returnedAll.size,
    returnedAfterReminderCents: returnedCents,
  };
}
