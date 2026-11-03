/**
 * The longer fixed sentences of /einstellungen, shared with `loading.tsx`:
 * the skeleton sets the same words, so they wrap to the same height and the
 * cards do not move when the page arrives (DESIGN.md section 10).
 */

/**
 * Karam's funnel (2026-10-10), said plainly: high ratings go on to Google and
 * Jameda, critical ones reach only the Praxis. The last word links to the
 * Patientenfeedback.
 */
export const REVIEW_INTRO = {
  text: "Nach dem Termin bekommt die Person eine E-Mail mit der Bitte um eine Bewertung. 4 und 5 Sterne führen direkt zu Google oder Jameda, 1 bis 3 Sterne erreichen nur Ihr ",
  link: "Patientenfeedback",
} as const;

/** The Praxis confirms the patients' consent; word for word as before. */
export const REVIEW_CONSENT =
  "Wir informieren unsere Patienten bereits bei der Terminvereinbarung darüber, dass sie nach dem Termin eine E-Mail mit der Bitte um eine Bewertung erhalten und dieser jederzeit widersprechen können. Nur mit dieser Bestätigung versendet EINS Bewertungs-Anfragen automatisch über die PVS-Anbindung.";

/** Wiederbehandlungen consent; word for word as before. */
export const REMINDER_CONSENT =
  "Wir sagen bei der Terminvereinbarung, dass wir per E-Mail an eine fällige Folgebehandlung erinnern können und dass man dem jederzeit widersprechen kann.";

export const REMINDER_ENABLE =
  "Geht nur zusammen mit dem Haken darüber und einem Buchungslink oder einer Telefonnummer.";

export const REMINDER_READ_ONLY = "Ein- und ausschalten kann das die Praxisinhaberin oder der Praxisinhaber.";

/** Organisch zuerst: nothing in the Werbekonten card is needed to start. */
export const WERBEKONTEN_INTRO =
  "Erst nötig, wenn bezahlte Anzeigen laufen. Bis dahin bringen Ihre Beiträge die Anfragen, ohne Werbekonto. Einmal verbunden, holen wir Ihre Werbezahlen täglich ab.";
