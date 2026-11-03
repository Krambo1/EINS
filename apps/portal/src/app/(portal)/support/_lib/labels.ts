import type { Tone } from "../../einstellungen/_components/settings-ui";

/** The address of a new message, `/support?neu=1`: the list's own page, so no new route. */
export const NEW_MESSAGE_PARAM = "neu";

/** A conversation's state as the Praxis sees it: a dot and a word (DESIGN.md section 5). */
export function caseStatus(status: string): { label: string; tone: Tone } {
  return status === "RESOLVED" ? { label: "Geklärt", tone: "good" } : { label: "Offen", tone: "none" };
}

/**
 * Who wrote a message. An answer of the KI says so on every message (EU AI
 * Act Art. 50); Karam's own answers are "EINS".
 */
export function senderLabel(direction: string): string {
  if (direction === "inbound") return "Ihre Praxis";
  if (direction === "automatic") return "EINS (KI)";
  return "EINS";
}

/** In place of the fields while an admin looks at the portal as the Praxis. */
export const IMPERSONATION_NOTE =
  "In der Ansicht als Benutzer schreibt nur die Praxis selbst. Bitte nutzen Sie die persönliche Betreuung in der Verwaltung.";

/** Under the text field: what must not go into a message. */
export const PRIVACY_NOTE = "Bitte keine Patientennamen, Gesundheitsdaten oder Passwörter.";

/** Before the first message: who answers (EU AI Act Art. 50). */
export const KI_NOTE = "Unsere KI beantwortet Fragen. Was eine persönliche Entscheidung braucht, übernimmt Karam.";
