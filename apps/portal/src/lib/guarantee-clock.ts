/**
 * Guarantee clock rules for "Keine Anfrage, keine Rechnung" (Kanon section 5).
 * Pure: no DB, no clock reads. Callers pass `today` as an ISO date in
 * Europe/Berlin so every rule is testable with fixed dates.
 *
 * Counting (BGB § 187 style): the day of signing is day 0, the day after is
 * day 1, the deadline is signing date + 90 calendar days + delay days. An
 * inquiry that arrives ON the deadline still counts.
 *
 * Delay days extend the deadline one for one. A Praxis delay runs from the
 * day after the missed Mitwirkungs-deadline through the day of fulfilment. A
 * platform disruption counts its own inclusive range. Overlapping ranges
 * count once. A range that starts after the (already extended) deadline does
 * not count: by then the collaboration had ended. An open range (not yet
 * fulfilled) counts through `today`, so the deadline keeps moving with it.
 *
 * Only NOTIFIED ranges count (Kanon: "EINS teilt jeden Verzug per E-Mail
 * mit"; the Praxis must know about an extension). This applies to Praxis
 * delays and platform disruptions alike. An unnotified range, or one notified
 * after `asOf`, does not move the deadline yet; once notified, all of its days
 * count, but only if the notice went out on or before the deadline valid on
 * that day (K-1, see computeDeadline).
 */

import type { ResponseState } from "./response-time";
import { classifyAttribution, type Attribution } from "./sources";
import { DAY_MS } from "./constants";

export const GUARANTEE_BASE_DAYS = 90;

/** "YYYY-MM-DD" */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toDayNumber(iso: IsoDate): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function fromDayNumber(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(iso) + days);
}

const berlinDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date of a timestamp in Europe/Berlin. */
export function berlinDate(ts: Date): IsoDate {
  return berlinDateFormatter.format(ts);
}

/** "2026-10-01" -> "01.10.2026" */
export function formatIsoDate(iso: IsoDate | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// ---------------------------------------------------------------------------
// Delays
// ---------------------------------------------------------------------------

export const DELAY_KINDS = ["verzug", "plattform_stoerung"] as const;
export type DelayKind = (typeof DELAY_KINDS)[number];

export const DELAY_KIND_LABELS: Record<DelayKind, string> = {
  verzug: "Verzug der Praxis",
  plattform_stoerung: "Plattform-Störung",
};

/** Inclusive range of days. `to: null` = still open. */
export interface DayWindow {
  from: IsoDate;
  to: IsoDate | null;
}

/** A delay or disruption as recorded. Counts only once `notifiedOn` is set. */
export interface DelayRange extends DayWindow {
  /** Day EINS told the Praxis by e-mail; null = not notified, does not count. */
  notifiedOn: IsoDate | null;
}

/** Whether a recorded range moves the deadline as of `asOf`. */
export function delayCounts(range: DelayRange, asOf: IsoDate): boolean {
  return range.notifiedOn !== null && toDayNumber(range.notifiedOn) <= toDayNumber(asOf);
}

/**
 * Turn "Mitwirkung was due on X, fulfilled on Y" into the counted range:
 * from the day after X through Y. Null when fulfilled on or before the due
 * date (no delay). `fulfilledOn: null` = not fulfilled yet (open range).
 */
export function verzugRange(
  missedDeadlineOn: IsoDate,
  fulfilledOn: IsoDate | null
): DayWindow | null {
  const from = addDays(missedDeadlineOn, 1);
  if (fulfilledOn !== null && toDayNumber(fulfilledOn) < toDayNumber(from)) return null;
  return { from, to: fulfilledOn };
}

interface DayRange {
  from: number;
  to: number;
}

/** Clip to the days after signing and up to `asOf`, then merge overlaps. */
function normalizeRanges(ranges: DelayRange[], signedDay: number, asOfDay: number): DayRange[] {
  const clipped: DayRange[] = [];
  for (const r of ranges) {
    if (!delayCounts(r, fromDayNumber(asOfDay))) continue;
    const from = Math.max(toDayNumber(r.from), signedDay + 1);
    const to = r.to === null ? asOfDay : Math.min(toDayNumber(r.to), asOfDay);
    if (to >= from) clipped.push({ from, to });
  }
  clipped.sort((a, b) => a.from - b.from);
  const merged: DayRange[] = [];
  for (const r of clipped) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to + 1) {
      last.to = Math.max(last.to, r.to);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

export interface DeadlineResult {
  deadline: IsoDate;
  delayDays: number;
  /** 90 + delayDays */
  totalDays: number;
}

/** Deadline from already accepted ranges, as of `asOfDay`. */
function deadlineFrom(signedDay: number, ranges: DelayRange[], asOfDay: number): { deadlineDay: number; delayDays: number } {
  let deadlineDay = signedDay + GUARANTEE_BASE_DAYS;
  let delayDays = 0;
  for (const r of normalizeRanges(ranges, signedDay, asOfDay)) {
    if (r.from > deadlineDay) break;
    const days = r.to - r.from + 1;
    delayDays += days;
    deadlineDay += days;
  }
  return { deadlineDay, delayDays };
}

/**
 * Deadline as known on `asOf`. Days after `asOf` are not counted yet, so a
 * delay entered with a future end date only extends the clock as its days
 * actually pass.
 *
 * K-1: a range counts only if it was notified on or before the deadline that
 * was valid on its notification day (the deadline day itself still counts).
 * Ranges are taken in order of `notifiedOn`, so an earlier notice can extend
 * the deadline far enough for a later one to still be in time. A notice sent
 * after the clock had run out never revives it: EINS may not collect delays
 * silently and claim them at the end.
 */
export function computeDeadline(
  signedOn: IsoDate,
  delays: DelayRange[],
  asOf: IsoDate
): DeadlineResult {
  const signedDay = toDayNumber(signedOn);
  const asOfDay = toDayNumber(asOf);
  const ordered = delays
    .filter((r) => delayCounts(r, asOf))
    .sort((a, b) => toDayNumber(a.notifiedOn!) - toDayNumber(b.notifiedOn!) || toDayNumber(a.from) - toDayNumber(b.from));
  const accepted: DelayRange[] = [];
  for (const r of ordered) {
    const notifiedDay = toDayNumber(r.notifiedOn!);
    if (notifiedDay <= deadlineFrom(signedDay, accepted, notifiedDay).deadlineDay) accepted.push(r);
  }
  const { deadlineDay, delayDays } = deadlineFrom(signedDay, accepted, asOfDay);
  return {
    deadline: fromDayNumber(deadlineDay),
    delayDays,
    totalDays: GUARANTEE_BASE_DAYS + delayDays,
  };
}

/**
 * K-1 for the admin actions: whether a notice sent on `notifiedOn` for a new
 * range would still count, given the ranges already recorded.
 */
export function noticeInTime(signedOn: IsoDate, delays: DelayRange[], notifiedOn: IsoDate): boolean {
  const { deadline } = computeDeadline(signedOn, delays, notifiedOn);
  return toDayNumber(notifiedOn) <= toDayNumber(deadline);
}

export const NOTICE_AFTER_DEADLINE = "Mitteilung nach Fristende zählt nicht mehr.";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const CLOCK_STATUSES = [
  "ohne_startdatum",
  "laeuft",
  "rechnung_faellig",
  "beendet_ohne_anfrage",
  "beendet_durch_praxis",
  "beendet_plattform_stoerung",
] as const;
export type ClockStatus = (typeof CLOCK_STATUSES)[number];

export const CLOCK_STATUS_LABELS: Record<ClockStatus, string> = {
  ohne_startdatum: "Kein Unterschriftsdatum",
  laeuft: "Läuft",
  rechnung_faellig: "Rechnung fällig",
  beendet_ohne_anfrage: "Beendet ohne Anfrage",
  beendet_durch_praxis: "Von der Praxis beendet (vor der ersten Rechnung)",
  beendet_plattform_stoerung: "Beendet wegen Plattform-Störung",
};

/** End states Karam sets by hand. The others are derived. */
export const MANUAL_END_STATES = ["beendet_durch_praxis", "beendet_plattform_stoerung"] as const;
export type ManualEndState = (typeof MANUAL_END_STATES)[number];

export interface ClockInput {
  signedOn: IsoDate | null;
  delays: DelayRange[];
  /** Date of the confirmed first qualified inquiry. */
  confirmedInquiryOn: IsoDate | null;
  manualEnd: { state: ManualEndState; on: IsoDate } | null;
  today: IsoDate;
}

export interface ClockState {
  status: ClockStatus;
  deadline: IsoDate | null;
  delayDays: number;
  /** N in "Tag X von N" */
  totalDays: number;
  /** X in "Tag X von N", 0 on the signing day, capped at N */
  dayNumber: number;
  /** Days until the deadline, 0 on the last day and afterwards */
  daysLeft: number;
}

export function computeClock(input: ClockInput): ClockState {
  if (!input.signedOn) {
    return {
      status: "ohne_startdatum",
      deadline: null,
      delayDays: 0,
      totalDays: GUARANTEE_BASE_DAYS,
      dayNumber: 0,
      daysLeft: GUARANTEE_BASE_DAYS,
    };
  }

  // The clock stops on the day the outcome was fixed.
  const stopOn = input.confirmedInquiryOn ?? input.manualEnd?.on ?? null;
  const asOf =
    stopOn !== null && toDayNumber(stopOn) < toDayNumber(input.today) ? stopOn : input.today;

  const { deadline, delayDays, totalDays } = computeDeadline(input.signedOn, input.delays, asOf);
  const signedDay = toDayNumber(input.signedOn);
  const asOfDay = toDayNumber(asOf);
  const deadlineDay = toDayNumber(deadline);

  let status: ClockStatus;
  if (input.confirmedInquiryOn) status = "rechnung_faellig";
  else if (input.manualEnd) status = input.manualEnd.state;
  else if (asOfDay > deadlineDay) status = "beendet_ohne_anfrage";
  else status = "laeuft";

  return {
    status,
    deadline,
    delayDays,
    totalDays,
    dayNumber: Math.min(Math.max(asOfDay - signedDay, 0), totalDays),
    daysLeft: Math.max(deadlineDay - asOfDay, 0),
  };
}

/**
 * Whether an inquiry that came in on `inquiryOn` may be confirmed as the first
 * qualified inquiry. Confirming later is fine (inquiry on the last day,
 * confirmed a day after): only the inquiry date has to be inside the window.
 */
export function checkConfirmable(
  input: Omit<ClockInput, "confirmedInquiryOn">,
  inquiryOn: IsoDate
): { ok: true } | { ok: false; reason: string } {
  if (!input.signedOn) return { ok: false, reason: "Erst das Unterschriftsdatum eintragen." };
  const day = toDayNumber(inquiryOn);
  // A manual end and a confirmed inquiry are mutually exclusive (DB CHECK
  // guarantee_clocks_single_outcome), whatever the inquiry date.
  if (input.manualEnd) {
    return {
      ok: false,
      reason:
        "Die Uhr wurde manuell beendet. Heben Sie das Ende zuerst mit „Ende aufheben“ auf, wenn die Anfrage davor einging.",
    };
  }
  if (day < toDayNumber(input.signedOn)) {
    return { ok: false, reason: "Die Anfrage kam vor der Unterschrift." };
  }
  const { deadline } = computeDeadline(input.signedOn, input.delays, input.today);
  if (day > toDayNumber(deadline)) {
    return { ok: false, reason: "Die Anfrage kam nach Fristablauf." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Candidate detection
// ---------------------------------------------------------------------------

export interface InquiryRow {
  id: string;
  createdAt: Date;
  source: string;
  utm: unknown;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status?: string;
}

export interface EligibleInquiry<T extends InquiryRow> {
  row: T;
  inquiryOn: IsoDate;
  attribution: Attribution;
  /** K-2: phone or e-mail present (after trim). Without, it cannot qualify. */
  hasContactData: boolean;
  /** K-2: the Praxis set the status to spam. Check, then reject. */
  isSpamMarked: boolean;
}

/** K-2: Anhang § 2 Abs. (1) requires a phone number or an e-mail address. */
export function hasContactData(row: { contactEmail?: string | null; contactPhone?: string | null }): boolean {
  return Boolean(row.contactPhone?.trim() || row.contactEmail?.trim());
}

/**
 * K-2: why an eligible inquiry may not be confirmed as the first qualified
 * one, or null. `earlierOpen` = an earlier, not rejected candidate exists;
 * `skipEarlier` = Karam confirmed on purpose that it was skipped.
 */
export function confirmBlockReason(
  e: { hasContactData: boolean; isSpamMarked: boolean },
  opts: { earlierOpen: boolean; skipEarlier: boolean }
): string | null {
  if (!e.hasContactData) {
    return "Die Anfrage hat weder Telefon noch E-Mail. Ohne Kontaktdaten ist sie keine qualifizierte Anfrage.";
  }
  if (e.isSpamMarked) {
    return "Die Praxis hat diese Anfrage als Spam markiert. Erst prüfen und gegebenenfalls ablehnen.";
  }
  if (opts.earlierOpen && !opts.skipEarlier) {
    return "Es gibt eine frühere mögliche Anfrage. Erst diese bestätigen oder ablehnen, oder das Überspringen ausdrücklich mit Notiz bestätigen.";
  }
  return null;
}

/**
 * Inquiries that could count: through an EINS-Messweg, on or after the
 * signing date (Berlin midnight), on or before the deadline, not rejected.
 * Earliest first; the first entry is the proposed candidate. Contact data
 * and spam marking are reported, not filtered: Karam decides (K-2).
 */
export function eligibleInquiries<T extends InquiryRow>(
  rows: T[],
  window: { signedOn: IsoDate; deadline: IsoDate; rejectedIds: ReadonlySet<string> }
): EligibleInquiry<T>[] {
  const from = toDayNumber(window.signedOn);
  const to = toDayNumber(window.deadline);
  const out: EligibleInquiry<T>[] = [];
  for (const row of rows) {
    if (window.rejectedIds.has(row.id)) continue;
    const inquiryOn = berlinDate(row.createdAt);
    const day = toDayNumber(inquiryOn);
    if (day < from || day > to) continue;
    const attribution = classifyAttribution({ source: row.source, utm: row.utm });
    if (!attribution.messweg) continue;
    out.push({
      row,
      inquiryOn,
      attribution,
      hasContactData: hasContactData(row),
      isSpamMarked: row.status === "spam",
    });
  }
  out.sort((a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime());
  return out;
}

/**
 * UTC timestamp range that surely contains every request whose Berlin date
 * lies in [signedOn, deadline]: one day of slack on each side covers the
 * Berlin offset. `eligibleInquiries` applies the exact day filter.
 */
export function inquiryScanRange(
  signedOn: IsoDate,
  deadline: IsoDate
): { from: Date; before: Date } {
  return {
    from: new Date(`${addDays(signedOn, -1)}T00:00:00Z`),
    before: new Date(`${addDays(deadline, 2)}T00:00:00Z`),
  };
}

export const REJECTION_REASONS = [
  "spam_automatisiert",
  "dieselbe_person_30_tage",
  "bewerbung",
  "verkaufsangebot",
  "keine_kontaktdaten",
  // K-3, migration 0089: test entries on the EINS Zielseite (onboarding).
  "test_eintrag",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  spam_automatisiert: "Spam oder automatisierte Eingabe",
  dieselbe_person_30_tage: "Dieselbe Person innerhalb von 30 Tagen",
  bewerbung: "Bewerbung",
  verkaufsangebot: "Verkaufs- oder Werbeangebot an die Praxis",
  keine_kontaktdaten: "Keine erreichbaren Kontaktdaten",
  test_eintrag: "Test der EINS-Seite, keine echte Person",
};

export interface RejectionContext {
  /** The inquiry carries a phone number or an e-mail address. */
  hasContactData: boolean;
  /** Attempt state from lib/response-time.ts `attemptInfo` (status ignored). */
  responseState: ResponseState;
  /**
   * Karam recorded that the Praxis proved an earlier contact attempt another
   * way (Garantie-Anhang § 6 Abs. (4): "der Praxis bleibt der Nachweis eines
   * früheren Kontaktversuchs unbenommen").
   */
  otherProof?: boolean;
}

/**
 * Folge 1 of the 48-Werkstunden rule (Garantie-Anhang § 6 Abs. (5) lit. a):
 * without a contact attempt in time the Praxis can no longer object that the
 * person was not real or not reachable. "keine_kontaktdaten" is therefore only
 * allowed when the inquiry has no phone and no e-mail at all, or a timely
 * attempt exists. Before the deadline, without an attempt, the objection has
 * to wait. Every other reason stays allowed.
 */
export function rejectionAllowed(
  reason: RejectionReason,
  ctx: RejectionContext
): { ok: true } | { ok: false; reason: string } {
  if (reason !== "keine_kontaktdaten") return { ok: true };
  if (!ctx.hasContactData) return { ok: true };
  if (ctx.otherProof) return { ok: true };
  switch (ctx.responseState) {
    case "rechtzeitig":
    case "ausgenommen":
      return { ok: true };
    case "offen":
      return { ok: false, reason: "Einwand erst nach einem Kontaktversuch der Praxis möglich." };
    case "zu_spaet":
    case "nicht_beantwortet":
      return {
        ok: false,
        reason:
          "Einwand ausgeschlossen: Die Praxis hat keinen Kontaktversuch innerhalb von 48 Werkstunden vermerkt (Garantie-Anhang § 6 Abs. (5) lit. a).",
      };
  }
}

// ---------------------------------------------------------------------------
// Overview ordering
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<ClockStatus, number> = {
  laeuft: 0,
  ohne_startdatum: 1,
  beendet_ohne_anfrage: 2,
  rechnung_faellig: 3,
  beendet_durch_praxis: 4,
  beendet_plattform_stoerung: 5,
};

/** Running clocks first, fewest days left on top. */
export function compareByUrgency(
  a: Pick<ClockState, "status" | "daysLeft">,
  b: Pick<ClockState, "status" | "daysLeft">
): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rank !== 0) return rank;
  return a.daysLeft - b.daysLeft;
}
