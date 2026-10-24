/**
 * KI-Klon record (clone_records, migration 0101): what the admin tab shows
 * and the texts it writes. Pure, no DB. The rules themselves (may a model be
 * created, is the clone usable, when is the deletion due) live in
 * lib/content-gate.ts; this file only builds on them.
 */

import {
  canCreateModel,
  cloneDeletionDueOn,
  cloneDeletionOverdue,
  type CloneFacts,
} from "./content-gate";
import { berlinDate, type IsoDate } from "./guarantee-clock";
import { formatDate } from "./formatting";

/** Checklist items that point the admin to the clone record (IDs are a storage contract). */
export const CLONE_CHECKLIST_ITEM_IDS = ["A5", "F5"] as const;

export function isCloneChecklistItem(itemId: string): boolean {
  return (CLONE_CHECKLIST_ITEM_IDS as readonly string[]).includes(itemId);
}

// ---------------------------------------------------------------------------
// Documents (consent, training opt-out): admin only, never under the
// Praxis's own key prefix, so neither the Praxis file route nor the Praxis
// upload route ever accepts such a key.
// ---------------------------------------------------------------------------

export const CLONE_DOCUMENT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "heic"] as const;
export const CLONE_DOCUMENT_ACCEPT = CLONE_DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(",");
export const MAX_CLONE_DOCUMENT_BYTES = 25 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `klon/<clinicId>/<uuid>.<ext>`: the shape of every clone document key. */
export const CLONE_DOCUMENT_KEY_PATTERN = new RegExp(`^klon/${UUID}/${UUID}\\.[a-z0-9]{1,8}$`);

export function cloneDocumentKeyPrefix(clinicId: string): string {
  return `klon/${clinicId}/`;
}

export function isCloneDocumentExtension(ext: string): boolean {
  return (CLONE_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
}

/** A clone document key of exactly this Praxis with an allowed extension. */
export function isCloneDocumentKey(clinicId: string, key: string): boolean {
  if (!CLONE_DOCUMENT_KEY_PATTERN.test(key)) return false;
  if (!key.startsWith(cloneDocumentKeyPrefix(clinicId))) return false;
  const ext = key.slice(key.lastIndexOf(".") + 1);
  return isCloneDocumentExtension(ext);
}

// ---------------------------------------------------------------------------
// Model gate: why "Modell angelegt" is not possible yet
// ---------------------------------------------------------------------------

export const MODEL_GATE_MESSAGE =
  "Ohne Einwilligung und dokumentierten Trainings-Widerspruch des Werkzeugs darf kein Modell angelegt werden.";

/** null when a model may be recorded now; otherwise the reason shown to the admin. */
export function modelBlockReason(c: CloneFacts): string | null {
  if (c.deletedAt) return "Der KI-Klon ist gelöscht.";
  if (c.revokedAt) return "Die Einwilligung ist widerrufen.";
  if (c.modelCreatedAt) return "Das Modell ist schon als angelegt vermerkt.";
  if (canCreateModel(c)) return null;
  return MODEL_GATE_MESSAGE;
}

/**
 * The model date must not lie before the documented opt-out (the opt-out
 * comes first, Betriebspflicht) and not in the future.
 */
export function modelDateProblem(c: CloneFacts, at: Date, now: Date): string | null {
  if (at.getTime() > now.getTime()) return "Das Datum liegt in der Zukunft.";
  if (c.trainingOptoutConfirmedAt && at.getTime() < c.trainingOptoutConfirmedAt.getTime()) {
    return "Das Modell darf erst nach dem dokumentierten Trainings-Widerspruch angelegt werden.";
  }
  if (c.consentSignedAt && at.getTime() < c.consentSignedAt.getTime()) {
    return "Das Modell darf erst nach der unterschriebenen Einwilligung angelegt werden.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Steps in the admin tab
// ---------------------------------------------------------------------------

export type CloneStepState = "erledigt" | "offen" | "ueberfaellig";

export interface CloneStep {
  key:
    | "einwilligung"
    | "widerspruch"
    | "modell"
    | "vertragsende"
    | "loeschung_faellig"
    | "geloescht";
  label: string;
  /** Formatted date, or null when the step has none yet. */
  date: string | null;
  state: CloneStepState;
}

export interface CloneStepInput extends CloneFacts {
  contractEndOn: IsoDate | null;
}

export function cloneSteps(r: CloneStepInput, today: IsoDate): CloneStep[] {
  const revokedOn = r.revokedAt ? berlinDate(r.revokedAt) : null;
  const dueOn = cloneDeletionDueOn(r.contractEndOn, revokedOn);
  const overdue = cloneDeletionOverdue(r.contractEndOn, r.deletedAt, today, revokedOn);
  const done = (v: unknown): CloneStepState => (v ? "erledigt" : "offen");
  return [
    {
      key: "einwilligung",
      label: "Einwilligung unterschrieben",
      date: r.consentSignedAt ? formatDate(r.consentSignedAt) : null,
      state: done(r.consentSignedAt && r.consentDocumentKey),
    },
    {
      key: "widerspruch",
      label: "Trainings-Widerspruch dokumentiert",
      date: r.trainingOptoutConfirmedAt ? formatDate(r.trainingOptoutConfirmedAt) : null,
      state: done(r.trainingOptoutConfirmedAt && r.trainingOptoutDocumentKey),
    },
    {
      key: "modell",
      label: "Modell angelegt",
      date: r.modelCreatedAt ? formatDate(r.modelCreatedAt) : null,
      state: done(r.modelCreatedAt),
    },
    {
      key: "vertragsende",
      label: "Vertragsende",
      date: r.contractEndOn ? formatDate(r.contractEndOn) : null,
      state: done(r.contractEndOn),
    },
    {
      key: "loeschung_faellig",
      label: "Löschung fällig am",
      date: dueOn ? formatDate(dueOn) : null,
      state: r.deletedAt ? "erledigt" : overdue ? "ueberfaellig" : "offen",
    },
    {
      key: "geloescht",
      label: "Gelöscht",
      date: r.deletedAt ? formatDate(r.deletedAt) : null,
      state: done(r.deletedAt),
    },
  ];
}

// ---------------------------------------------------------------------------
// Revocation texts
// ---------------------------------------------------------------------------

/** stop_requested_reason of every post a revocation flags. */
export function revocationStopReason(revokedAt: Date): string {
  return `Widerruf KI-Klon am ${formatDate(revokedAt)}`;
}

export function postCountLabel(n: number): string {
  return n === 1 ? "1 Beitrag" : `${n} Beiträge`;
}

/** The e-mail EINS gets after a revocation. */
export function revocationMail(input: {
  clinicName: string;
  personName: string;
  tool: string;
  revokedAt: Date;
  note: string;
  postCount: number;
  adminLink: string;
}): { subject: string; text: string } {
  const subject = `Widerruf KI-Klon: ${input.clinicName}, ${postCountLabel(input.postCount)} zu stoppen`;
  const text = [
    `Bei ${input.clinicName} wurde die Einwilligung für den KI-Klon widerrufen.`,
    "",
    `Person: ${input.personName}`,
    `Werkzeug: ${input.tool}`,
    `Widerruf erfasst am: ${formatDate(input.revokedAt)}`,
    `Notiz: ${input.note}`,
    "",
    input.postCount > 0
      ? `${postCountLabel(input.postCount)} mit dem KI-Klon ${input.postCount === 1 ? "ist" : "sind"} als „zu stoppen“ markiert. Bitte sofort stoppen und das Klon-Modell beim Werkzeug löschen.`
      : "Es gibt keinen Beitrag mit dem KI-Klon, der noch gestoppt werden muss. Bitte das Klon-Modell beim Werkzeug löschen.",
    "",
    `KI-Klon der Praxis: ${input.adminLink}`,
  ].join("\n");
  return { subject, text };
}
