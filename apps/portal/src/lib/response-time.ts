/**
 * Response time of the Praxis: 48 Werkstunden per inquiry with three
 * consequences (KANON section 6a, Garantie-Anhang v2.1 § 6 Abs. (4) to (7)).
 * Pure: no DB, no clock reads. Callers pass `now`.
 *
 * The first contact attempt (`firstAttemptAt`) is derived in SQL by
 * src/server/queries/response-time.ts; this module only judges it.
 *
 *   Folge 1  rejecting a candidate as "keine Kontaktdaten" needs a timely
 *            attempt (rule lives in lib/guarantee-clock.ts, rejectionAllowed)
 *   Folge 2  per inquiry state + labels for the portal and the monthly report
 *   Folge 3  three or more overdue inquiries: warning, ads pause, resume
 *            (evaluateEnforcement below; the pause itself is manual)
 */

import { berlinDate, formatIsoDate, isIsoDate, type IsoDate } from "./guarantee-clock";
import { berlinMidnight, endOfNextWerktag, responseDeadline } from "./werkstunden";

/**
 * The rule took effect with the contract documents of 06.10.2026. Inquiries
 * that arrived before 00:00 Berlin on that day have no deadline: flagging them
 * as "nicht beantwortet" would apply a rule nobody had agreed to yet.
 */
export const RESPONSE_RULE_START = new Date("2026-10-05T22:00:00.000Z");

/**
 * K-3: the Praxis owes the 48 Werkstunden only from the contract on. Rule
 * start for one Praxis: Berlin midnight of its signing date
 * (guarantee_clocks.signed_on), never before RESPONSE_RULE_START. Without a
 * signing date the global start applies.
 */
export function responseRuleStartFor(signedOn: IsoDate | null | undefined): Date {
  if (!signedOn || !isIsoDate(signedOn)) return RESPONSE_RULE_START;
  const signed = berlinMidnight(signedOn);
  return signed.getTime() > RESPONSE_RULE_START.getTime() ? signed : RESPONSE_RULE_START;
}

function ruleStartOf(input: { ruleStart?: Date | null }): Date {
  const own = input.ruleStart;
  return own && own.getTime() > RESPONSE_RULE_START.getTime() ? own : RESPONSE_RULE_START;
}

/** Overdue inquiries at the same time that allow a warning and a pause. */
export const ENFORCEMENT_THRESHOLD = 3;

export const RESPONSE_STATES = [
  "offen",
  "rechtzeitig",
  "zu_spaet",
  "nicht_beantwortet",
  "ausgenommen",
] as const;
export type ResponseState = (typeof RESPONSE_STATES)[number];

export const RESPONSE_STATE_LABELS: Record<ResponseState, string> = {
  offen: "Frist läuft",
  rechtzeitig: "Rechtzeitig kontaktiert",
  zu_spaet: "Von der Praxis zu spät beantwortet",
  nicht_beantwortet: "Von der Praxis nicht beantwortet",
  ausgenommen: "Ohne Frist",
};

/** States the contract (§ 6 Abs. (5) lit. b) wants shown separately. */
export function isPraxisResponseFlag(
  state: ResponseState
): state is "zu_spaet" | "nicht_beantwortet" {
  return state === "zu_spaet" || state === "nicht_beantwortet";
}

export interface ResponseInput {
  createdAt: Date;
  firstAttemptAt: Date | null;
  status: string;
  /**
   * K-3: rule start of this Praxis (responseRuleStartFor). Omitted = the
   * global RESPONSE_RULE_START. An inquiry before it has no deadline.
   */
  ruleStart?: Date | null;
}

export interface ResponseInfo {
  state: ResponseState;
  /** Null when the inquiry has no deadline (before the rule started). */
  deadline: Date | null;
}

/**
 * State of the contact attempt alone, ignoring the request status. Used by
 * Folge 1, where a spam-marked inquiry still needs the attempt question
 * answered. "ausgenommen" here only means "arrived before the rule".
 */
export function attemptInfo(
  input: Pick<ResponseInput, "createdAt" | "firstAttemptAt" | "ruleStart">,
  now: Date
): ResponseInfo {
  if (input.createdAt.getTime() < ruleStartOf(input).getTime()) {
    return { state: "ausgenommen", deadline: null };
  }
  const deadline = responseDeadline(input.createdAt);
  if (input.firstAttemptAt) {
    return {
      state: input.firstAttemptAt.getTime() <= deadline.getTime() ? "rechtzeitig" : "zu_spaet",
      deadline,
    };
  }
  return { state: now.getTime() <= deadline.getTime() ? "offen" : "nicht_beantwortet", deadline };
}

/** Folge 2: inquiries marked as spam do not count. */
export function responseInfo(input: ResponseInput, now: Date): ResponseInfo {
  const info = attemptInfo(input, now);
  if (input.status === "spam") return { state: "ausgenommen", deadline: info.deadline };
  return info;
}

export function responseState(input: ResponseInput, now: Date): ResponseState {
  return responseInfo(input, now).state;
}

export interface ResponseCounts {
  /** Inquiries with a deadline, spam excluded. */
  total: number;
  rechtzeitig: number;
  zuSpaet: number;
  nichtBeantwortet: number;
  /** Deadline still running at `now`. */
  offen: number;
  /** Arrived before the rule started or before the contract (spam excluded). */
  vorRegel: number;
}

/** Monthly report counts. Spam is left out entirely. */
export function countResponseStates(rows: ResponseInput[], now: Date): ResponseCounts {
  const out: ResponseCounts = {
    total: 0,
    rechtzeitig: 0,
    zuSpaet: 0,
    nichtBeantwortet: 0,
    offen: 0,
    vorRegel: 0,
  };
  for (const row of rows) {
    if (row.status === "spam") continue;
    const state = responseState(row, now);
    if (state === "ausgenommen") {
      out.vorRegel++;
      continue;
    }
    out.total++;
    if (state === "rechtzeitig") out.rechtzeitig++;
    else if (state === "zu_spaet") out.zuSpaet++;
    else if (state === "nicht_beantwortet") out.nichtBeantwortet++;
    else out.offen++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Folge 3: warning, ads pause, resume
// ---------------------------------------------------------------------------

export const ENFORCEMENT_KINDS = ["warnung", "pause", "fortgesetzt"] as const;
export type EnforcementKind = (typeof ENFORCEMENT_KINDS)[number];

export const ENFORCEMENT_KIND_LABELS: Record<EnforcementKind, string> = {
  warnung: "Warnung",
  pause: "Anzeigen-Pause",
  fortgesetzt: "Fortgesetzt",
};

/** One inquiry of a Praxis with a deadline, spam excluded. */
export interface DeadlineRow {
  id: string;
  deadline: Date;
  firstAttemptAt: Date | null;
}

export interface EnforcementEvent {
  kind: EnforcementKind;
  occurredAt: Date;
  /** For a pause: the overdue inquiries at that moment. */
  requestIds: string[];
}

/**
 * Inquiries that were past their deadline without an attempt at `at`. An
 * attempt made after `at` still counts as open at `at`, so the same rows give
 * the count at the end of a cure period that already lies in the past.
 */
export function overdueOpenAt(rows: DeadlineRow[], at: Date): DeadlineRow[] {
  const t = at.getTime();
  return rows.filter(
    (r) => r.deadline.getTime() < t && (r.firstAttemptAt === null || r.firstAttemptAt.getTime() > t)
  );
}

/** Turn a request into a DeadlineRow, or null when it has no deadline or is spam. */
export function toDeadlineRow(
  input: ResponseInput & { id: string }
): DeadlineRow | null {
  if (input.status === "spam") return null;
  if (input.createdAt.getTime() < ruleStartOf(input).getTime()) return null;
  return { id: input.id, deadline: responseDeadline(input.createdAt), firstAttemptAt: input.firstAttemptAt };
}

export interface EnforcementState {
  /** Overdue without attempt right now, oldest deadline first. */
  overdueOpen: DeadlineRow[];
  paused: boolean;
  /** The pause currently in force. */
  pause: EnforcementEvent | null;
  /** Most recent warning of any cycle, for display. */
  lastWarning: EnforcementEvent | null;
  /** Warning of the current cycle (after the last pause or resume). */
  activeWarning: EnforcementEvent | null;
  /** End of the Werktag after the active warning. */
  cureDeadline: Date | null;
  /** Overdue count at the cure deadline, once it has passed. */
  overdueAtCureDeadline: number | null;
  canWarn: boolean;
  canPause: boolean;
  /** Why a pause may not be recorded now (German, for the admin page). */
  pauseBlockedReason: string | null;
  /** Inquiries of the pause snapshot still without attempt. */
  stillOpenFromPause: string[];
  /** Paused and every snapshot inquiry has an attempt now: resume ads. */
  resumeDue: boolean;
}

/**
 * Folge 3 (Garantie-Anhang § 6 Abs. (5) lit. c): with three or more overdue
 * inquiries at the same time EINS may warn; if three or more are still
 * overdue at the end of the next Werktag after the warning, EINS may pause
 * paid ads; EINS resumes as soon as the inquiries overdue at pause time have
 * an attempt. A warning whose cure deadline passed with fewer than three
 * overdue inquiries is spent: a later pause needs a new warning.
 */
export function evaluateEnforcement(input: {
  rows: DeadlineRow[];
  events: EnforcementEvent[];
  now: Date;
  formatDate?: (d: Date) => string;
}): EnforcementState {
  const { rows, now } = input;
  const fmt = input.formatDate ?? ((d: Date) => d.toISOString());
  const events = [...input.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const overdueOpen = overdueOpenAt(rows, now).sort(
    (a, b) => a.deadline.getTime() - b.deadline.getTime()
  );
  const overdueIds = new Set(overdueOpen.map((r) => r.id));

  let pause: EnforcementEvent | null = null;
  let cycleStart = -Infinity;
  let lastWarning: EnforcementEvent | null = null;
  for (const e of events) {
    if (e.kind === "pause") {
      pause = e;
      cycleStart = e.occurredAt.getTime();
    } else if (e.kind === "fortgesetzt") {
      pause = null;
      cycleStart = e.occurredAt.getTime();
    } else {
      lastWarning = e;
    }
  }
  const paused = pause !== null;
  const activeWarning =
    !paused && lastWarning && lastWarning.occurredAt.getTime() > cycleStart ? lastWarning : null;

  const cureDeadline = activeWarning ? endOfNextWerktag(activeWarning.occurredAt) : null;
  const overdueAtCureDeadline =
    cureDeadline && now.getTime() >= cureDeadline.getTime()
      ? overdueOpenAt(rows, cureDeadline).length
      : null;
  const warningSpent = overdueAtCureDeadline !== null && overdueAtCureDeadline < ENFORCEMENT_THRESHOLD;
  const enough = overdueOpen.length >= ENFORCEMENT_THRESHOLD;

  let pauseBlockedReason: string | null = null;
  if (paused) pauseBlockedReason = "Die Anzeigen sind bereits pausiert.";
  else if (!activeWarning) pauseBlockedReason = "Erst eine Warnung vermerken.";
  else if (overdueAtCureDeadline === null)
    pauseBlockedReason = `Die Frist aus der Warnung läuft bis ${fmt(cureDeadline!)}.`;
  else if (warningSpent)
    pauseBlockedReason =
      "Am Ende des Werktags nach der Warnung lagen weniger als drei Anfragen offen. Für eine Pause ist eine neue Warnung nötig.";
  else if (!enough) pauseBlockedReason = "Zurzeit liegen weniger als drei Anfragen offen.";

  const stillOpenFromPause = pause ? pause.requestIds.filter((id) => overdueIds.has(id)) : [];

  return {
    overdueOpen,
    paused,
    pause,
    lastWarning,
    activeWarning,
    cureDeadline,
    overdueAtCureDeadline,
    canWarn: !paused && enough && (activeWarning === null || warningSpent),
    canPause: pauseBlockedReason === null,
    pauseBlockedReason,
    stillOpenFromPause,
    resumeDue: paused && stillOpenFromPause.length === 0,
  };
}

/** The Werktag a cure deadline closes: "Freitag, 09.10.2026". */
export function formatCureDeadline(cureDeadline: Date): string {
  // cureDeadline is the midnight AFTER the Werktag; step back into that day.
  const day = berlinDate(new Date(cureDeadline.getTime() - 1));
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`)
  );
  return `${weekday}, ${formatIsoDate(day)}`;
}

/**
 * Warning e-mail for Folge 3 (Sie-Form). Karam copies and sends it himself;
 * the portal never sends it. Counts and dates only, no patient data.
 */
export function warningEmailText(input: { count: number; cureDeadline: Date }): {
  subject: string;
  body: string;
} {
  const n = input.count;
  const anfragen = n === 1 ? "eine Anfrage" : `${n} Anfragen`;
  return {
    subject: "Offene Anfragen ohne Kontaktversuch",
    body: [
      "Guten Tag,",
      "",
      `in Ihrem EINS-Portal liegen derzeit ${anfragen}, bei denen seit Eingang mehr als 48 Werkstunden ohne Kontaktversuch vergangen sind.`,
      "",
      `Bitte versuchen Sie bis zum Ende des Werktags ${formatCureDeadline(input.cureDeadline)}, diese Personen zu kontaktieren, und vermerken Sie das im Portal: mit „Anruf protokollieren“ (jedes Ergebnis zählt) oder mit dem Status „Kontaktiert“, „Nicht erreicht“ oder „Termin vereinbart“. Ein Gespräch muss dafür nicht zustande kommen.`,
      "",
      "Liegen dann weiterhin drei oder mehr solcher Anfragen offen, dürfen wir die bezahlten Anzeigen nach § 6 Abs. (5) lit. c des Garantie-Anhangs pausieren. Sobald Sie diese Anfragen kontaktiert haben, setzen wir die Anzeigen unverzüglich fort.",
      "",
      "Die 48 Werkstunden sind keine Bedingung der Garantie. Ihre Garantie bleibt davon unberührt, und Ihre organischen Beiträge laufen in jedem Fall weiter.",
      "",
      "Die betroffenen Anfragen finden Sie im Portal unter „Anfragen“, gekennzeichnet als „Von der Praxis nicht beantwortet“.",
      "",
      "Herzliche Grüße",
      "Ihr EINS-Team",
    ].join("\n"),
  };
}
