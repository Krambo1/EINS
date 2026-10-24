/**
 * Phase 4 rules for posts (Beiträge): the compliance gate before a post may
 * go to the Praxis for approval, the 2-Werktage approval deadline, who may
 * decide, and the KI-Klon record. Pure, no DB.
 *
 * KANON § 5/§ 6: "Kein Beitrag ohne Ihre Freigabe", posts approved or
 * concretely changed within 2 Werktagen (weekly batch), no automatic
 * approval, a Verzug counts only after EINS told the Praxis by e-mail.
 */

import type { Role } from "./constants";
import { addDays, berlinDate, toDayNumber, type IsoDate } from "./guarantee-clock";
import { berlinMidnight, isAnyStatutoryHoliday } from "./werkstunden";
import type { ContentStatus } from "./content-status";

// ---------------------------------------------------------------------------
// Compliance gate (Prüf-Schranke)
// ---------------------------------------------------------------------------

/** The label every AI-made post carries (KANON wording). */
export const KI_LABEL = "KI-generiert";

export function hasKiLabel(caption: string | null | undefined): boolean {
  return !!caption && caption.toLowerCase().includes(KI_LABEL.toLowerCase());
}

export const NO_BEFORE_AFTER_CONFIRMATION =
  "Keine Vorher-Nachher-Darstellung, keine KI-Patientin, kein KI-Behandlungsergebnis.";

export interface GateHwgCheck {
  /** The exact text that was checked. */
  input: string;
  verdict: "clean" | "warn" | "violation";
}

export interface GateItem {
  status: ContentStatus;
  caption: string | null;
  usesClone: boolean;
  aiContent: boolean;
  /** The HWG check linked to the post (content_items.hwg_check_id). */
  hwgCheck: GateHwgCheck | null;
  hwgWarningsAckBy: string | null;
  noBeforeAfterConfirmedBy: string | null;
}

export const GATE_REASONS = [
  "status",
  "caption_missing",
  "hwg_missing",
  "hwg_outdated",
  "hwg_violation",
  "hwg_warnings_unacknowledged",
  "ki_label_missing",
  "no_before_after_unconfirmed",
  "clone_record_invalid",
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

export const GATE_REASON_LABELS: Record<GateReason, string> = {
  status: "Nur ein Entwurf kann zur Freigabe gehen.",
  caption_missing: "Der Beitragstext fehlt.",
  hwg_missing: "Der Beitragstext ist noch nicht HWG-geprüft.",
  hwg_outdated: "Der Beitragstext wurde nach der HWG-Prüfung geändert. Bitte erneut prüfen.",
  hwg_violation: "Die HWG-Prüfung hat einen Verstoß gefunden.",
  hwg_warnings_unacknowledged: "Die Hinweise der HWG-Prüfung sind noch nicht namentlich bestätigt.",
  ki_label_missing: `Der Beitragstext enthält den Hinweis „${KI_LABEL}“ nicht.`,
  no_before_after_unconfirmed:
    "Die Bestätigung „Keine Vorher-Nachher-Darstellung, keine KI-Patientin, kein KI-Behandlungsergebnis“ fehlt.",
  clone_record_invalid:
    "Für den KI-Klon fehlt ein gültiger Nachweis (Einwilligung, Trainings-Widerspruch, Modell, kein Widerruf).",
};

export type GateResult = { ok: true } | { ok: false; reasons: GateReason[] };

/**
 * Whether a post may move to "zur_freigabe". Every reason that blocks is
 * returned, so the admin sees all of them at once.
 */
export function canSubmitForApproval(item: GateItem, clone: CloneFacts | null): GateResult {
  const reasons: GateReason[] = [];
  if (item.status !== "entwurf") reasons.push("status");

  const caption = item.caption?.trim() ?? "";
  if (!caption) {
    reasons.push("caption_missing");
  } else if (!item.hwgCheck) {
    reasons.push("hwg_missing");
  } else if (item.hwgCheck.input.trim() !== caption) {
    reasons.push("hwg_outdated");
  } else if (item.hwgCheck.verdict === "violation") {
    reasons.push("hwg_violation");
  } else if (item.hwgCheck.verdict === "warn" && !item.hwgWarningsAckBy?.trim()) {
    reasons.push("hwg_warnings_unacknowledged");
  }

  if ((item.usesClone || item.aiContent) && !hasKiLabel(caption)) reasons.push("ki_label_missing");
  if (!item.noBeforeAfterConfirmedBy?.trim()) reasons.push("no_before_after_unconfirmed");
  if (item.usesClone && !cloneUsable(clone)) reasons.push("clone_record_invalid");

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// ---------------------------------------------------------------------------
// Approval deadline (D9)
// ---------------------------------------------------------------------------

/** Mon to Fri and no statutory holiday in any of the 16 Länder (D9). */
export function isApprovalWorkday(day: IsoDate): boolean {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd >= 1 && wd <= 5 && !isAnyStatutoryHoliday(day);
}

export const APPROVAL_WORKDAYS = 2;

/** The last day the Praxis has: the 2nd approval workday after the sending day. */
export function approvalDueDay(sentAt: Date): IsoDate {
  let day = berlinDate(sentAt);
  let left = APPROVAL_WORKDAYS;
  while (left > 0) {
    day = addDays(day, 1);
    if (isApprovalWorkday(day)) left--;
  }
  return day;
}

/**
 * due_at of a batch: the end of approvalDueDay (24:00 Berlin, stored as the
 * following midnight). Skipping the holidays of all Länder means a Verzug
 * never starts too early anywhere.
 */
export function approvalDueAt(sentAt: Date): Date {
  return berlinMidnight(addDays(approvalDueDay(sentAt), 1));
}

/** First counted Verzug day of a late batch: the day after the due day. */
export function verzugStartDay(dueAt: Date): IsoDate {
  return berlinDate(dueAt);
}

// ---------------------------------------------------------------------------
// Who decides
// ---------------------------------------------------------------------------

/** Roles that may approve or ask for changes. Clone posts: Inhaber only. */
export const APPROVER_ROLES = ["inhaber", "marketing"] as const satisfies readonly Role[];

export function canDecideApproval(role: Role | null | undefined, inhaberOnly: boolean): boolean {
  if (!role) return false;
  if (inhaberOnly) return role === "inhaber";
  return (APPROVER_ROLES as readonly Role[]).includes(role);
}

/** Recipients of the batch e-mail for a post. */
export function approvalRecipientRoles(inhaberOnly: boolean): readonly Role[] {
  return inhaberOnly ? ["inhaber"] : APPROVER_ROLES;
}

/** How long a one-click link stays usable; the portal buttons keep working after that. */
export const APPROVAL_TOKEN_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// KI-Klon record
// ---------------------------------------------------------------------------

export interface CloneFacts {
  consentSignedAt: Date | null;
  consentDocumentKey: string | null;
  trainingOptoutDocumentKey: string | null;
  trainingOptoutConfirmedAt: Date | null;
  modelCreatedAt: Date | null;
  revokedAt: Date | null;
  deletedAt: Date | null;
}

/**
 * Betriebspflicht (07.10.2026): a model may only be created once the consent
 * is signed and the tool's training opt-out is documented and confirmed.
 */
export function canCreateModel(c: CloneFacts): boolean {
  return (
    !!c.consentSignedAt &&
    !!c.consentDocumentKey &&
    !!c.trainingOptoutDocumentKey &&
    !!c.trainingOptoutConfirmedAt &&
    !c.revokedAt &&
    !c.deletedAt
  );
}

/** A clone a new post may use: model built on a valid basis, not revoked, not deleted. */
export function cloneUsable(c: CloneFacts | null): boolean {
  return !!c && !!c.modelCreatedAt && canCreateModel(c);
}

/** KANON: the model is deleted at the latest 30 days after contract end. */
export const CLONE_DELETION_DAYS_AFTER_END = 30;

/**
 * Day the model must be deleted by: 30 days after contract end, or at once
 * on a revocation (KANON § 7: "stoppt EINS sofort ... und löscht das
 * Modell"), whichever comes first. Null while neither happened.
 */
export function cloneDeletionDueOn(contractEndOn: IsoDate | null, revokedOn: IsoDate | null = null): IsoDate | null {
  const afterEnd = contractEndOn ? addDays(contractEndOn, CLONE_DELETION_DAYS_AFTER_END) : null;
  if (afterEnd && revokedOn) return toDayNumber(revokedOn) < toDayNumber(afterEnd) ? revokedOn : afterEnd;
  return afterEnd ?? revokedOn;
}

/** Deletion still owed and its due day reached (admin home alarm is red). */
export function cloneDeletionOverdue(
  contractEndOn: IsoDate | null,
  deletedAt: Date | null,
  today: IsoDate,
  revokedOn: IsoDate | null = null
): boolean {
  const due = cloneDeletionDueOn(contractEndOn, revokedOn);
  return !deletedAt && due !== null && toDayNumber(today) >= toDayNumber(due);
}

/**
 * Posts a revocation affects: every clone post not stopped yet. Posts that
 * are not live are stopped at once (nothing is online); live posts are
 * flagged "zu stoppen" until EINS has taken them down.
 */
export function postsToStopOnRevocation<T extends { usesClone: boolean; status: ContentStatus }>(
  items: readonly T[]
): T[] {
  return items.filter((i) => i.usesClone && i.status !== "gestoppt");
}
