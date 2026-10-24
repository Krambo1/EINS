/**
 * Approval decisions on posts (Beiträge), pure. Shared by the one-click link
 * (/freigabe/[token]) and the portal buttons on /beitraege (D7: both at the
 * same time, the first decision wins). The DB side lives in
 * server/content-approval.ts; this module holds the rules it applies.
 */

import { addDays, berlinDate, formatIsoDate, type IsoDate } from "./guarantee-clock";
import { canPraxisDecide, type ContentStatus } from "./content-status";

export const APPROVAL_DECISIONS = ["freigegeben", "aenderung"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  freigegeben: "Freigegeben",
  aenderung: "Änderung gewünscht",
};

export const CHANGE_TEXT_MAX = 2000;

export function isApprovalDecision(v: unknown): v is ApprovalDecision {
  return typeof v === "string" && (APPROVAL_DECISIONS as readonly string[]).includes(v);
}

export type DecisionInput =
  | { ok: true; decision: ApprovalDecision; changeText: string | null }
  | { ok: false; error: string };

/**
 * Validates a decision. "aenderung" needs a non-empty description (the DB
 * CHECK enforces the same); "freigegeben" drops any text.
 */
export function normalizeDecision(decision: unknown, changeText: unknown): DecisionInput {
  if (!isApprovalDecision(decision)) return { ok: false, error: "Unbekannte Entscheidung." };
  if (decision === "freigegeben") return { ok: true, decision, changeText: null };
  const text = typeof changeText === "string" ? changeText.trim() : "";
  if (!text) return { ok: false, error: "Bitte beschreiben Sie, was wir ändern sollen." };
  if (text.length > CHANGE_TEXT_MAX) {
    return { ok: false, error: `Bitte fassen Sie die Änderung in höchstens ${CHANGE_TEXT_MAX} Zeichen.` };
  }
  return { ok: true, decision, changeText: text };
}

/**
 * The post status a recorded decision leads to, or null when the post is no
 * longer waiting (EINS stopped it meanwhile): the decision is still kept on
 * the approval row, the post status stays as it is.
 */
export function statusAfterDecision(current: ContentStatus, decision: ApprovalDecision): ContentStatus | null {
  return canPraxisDecide(current, decision) ? decision : null;
}

export interface RecordedDecision {
  decision: ApprovalDecision;
  changeText: string | null;
  decidedAt: Date;
  decidedVia: "portal" | "link";
}

/**
 * First decision wins. `claimed` is the row the conditional UPDATE
 * (`WHERE decision IS NULL`) returned, `existing` the row as it is now. A
 * second attempt is not an error: it gets the decision already on record.
 */
export function firstDecisionOutcome(
  claimed: RecordedDecision | null,
  existing: RecordedDecision | null
): { recorded: true; decision: RecordedDecision } | { recorded: false; decision: RecordedDecision | null } {
  if (claimed) return { recorded: true, decision: claimed };
  return { recorded: false, decision: existing };
}

/** A link may decide only while it is valid; a decided post shows its decision regardless. */
export function linkExpired(tokenExpiresAt: Date, now: Date = new Date()): boolean {
  return tokenExpiresAt.getTime() <= now.getTime();
}

export const LINK_EXPIRED_MESSAGE = "Dieser Link ist abgelaufen. Bitte entscheiden Sie im Portal unter Beiträge.";

/** Last day the Praxis has: due_at is the following Berlin midnight. */
export function approvalDueDayOf(dueAt: Date): IsoDate {
  return addDays(berlinDate(dueAt), -1);
}

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" });

/** "Mittwoch, 14.10.2026" for the last day of a batch. */
export function formatApprovalDue(dueAt: Date): string {
  const day = approvalDueDayOf(dueAt);
  return `${WEEKDAY.format(new Date(`${day}T12:00:00Z`))}, ${formatIsoDate(day)}`;
}

/** Reason text of the Verzug a late batch causes (guarantee_delays.reason). */
export function approvalVerzugReason(sentAt: Date): string {
  return `Freigabe der Beiträge vom ${formatIsoDate(berlinDate(sentAt))} nicht innerhalb von 2 Werktagen`;
}

/**
 * Last day of a Verzug once every post of the batch is decided: the Berlin
 * day of the last decision, never before the first Verzug day (DB range check).
 */
export function verzugEndDay(fromDate: IsoDate, lastDecisionAt: Date | null, now: Date = new Date()): IsoDate {
  const day = berlinDate(lastDecisionAt ?? now);
  return day < fromDate ? fromDate : day;
}

export interface ApprovalRecipient {
  email: string;
  fullName: string | null;
  role: string;
}

/**
 * Who gets which posts by e-mail: every active Inhaber and Marketing user
 * gets the normal posts, clone posts go to Inhaber users only
 * (approvalRecipientRoles). Recipients without any post are dropped, e-mail
 * addresses are de-duplicated (lowercase).
 */
export function groupApprovalRecipients<T extends { inhaberOnly: boolean }>(
  posts: readonly T[],
  users: readonly ApprovalRecipient[],
  rolesFor: (inhaberOnly: boolean) => readonly string[]
): Array<{ recipient: ApprovalRecipient; posts: T[] }> {
  const seen = new Set<string>();
  const out: Array<{ recipient: ApprovalRecipient; posts: T[] }> = [];
  for (const u of users) {
    const email = u.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const mine = posts.filter((p) => rolesFor(p.inhaberOnly).includes(u.role));
    if (mine.length > 0) out.push({ recipient: { ...u, email }, posts: mine });
  }
  return out;
}
