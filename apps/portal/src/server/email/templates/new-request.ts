import { escapeHtml, renderEmailLayout } from "@/server/email";

/**
 * "Neue Anfrage" mail to the Praxis team (inhaber + frontdesk).
 *
 * Privacy: this mail carries NO patient data. No name, phone, email or
 * message, only treatment, source, time and a link into the portal, where
 * the team sees the details after logging in.
 */

export interface NewRequestEmailInput {
  clinicName: string;
  /** Treatment label as chosen in the form, or null. */
  treatment: string | null;
  /**
   * True when `treatment` is the name of the Praxis's own catalogue entry
   * (requests.treatment_id matched), false when it is free text typed by the
   * patient (Meta form field). Undefined = unknown: the label is only shown
   * when it passes `isSafeTreatmentLabel` (L-13).
   */
  treatmentFromCatalog?: boolean;
  /** Human-readable source, e.g. "Zielseiten-Formular". */
  sourceLabel: string;
  /** Berlin wall time, already formatted (formatDateTime). */
  receivedAtLabel: string;
  /** Absolute link to /anfragen/<id>. */
  link: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Collapse whitespace and cap, so a long form value can't bloat the subject. */
export function cleanTreatmentLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/**
 * A free-text treatment label may carry a name, phone number or e-mail
 * address ("Brustvergrößerung, bin Brigitte Meier, 0171..."). Subject and
 * preview show up on lock screens and in the provider log, so an unverified
 * label is only used when it looks like a plain treatment name: short, at
 * most four words, no digits, no "@", no punctuation that separates clauses.
 */
export function isSafeTreatmentLabel(label: string): boolean {
  if (label.length > 40) return false;
  if (/[0-9@,;:/\()\[\]<>!?]/.test(label)) return false;
  return label.split(" ").filter(Boolean).length <= 4;
}

/** Label for subject and body, or null when it must stay in the portal. */
export function treatmentLabelForMail(
  raw: string | null | undefined,
  fromCatalog?: boolean
): string | null {
  const label = cleanTreatmentLabel(raw);
  if (!label) return null;
  if (fromCatalog === true) return label;
  if (fromCatalog === false) return null;
  return isSafeTreatmentLabel(label) ? label : null;
}

export function renderNewRequestEmail(input: NewRequestEmailInput): RenderedEmail {
  const treatment = treatmentLabelForMail(input.treatment, input.treatmentFromCatalog);
  const subject = treatment ? `Neue Anfrage: ${treatment}` : "Neue Anfrage über EINS";
  const intro =
    "Für Ihre Praxis ist über EINS eine neue Anfrage eingegangen. " +
    "Name und Kontaktdaten sehen Sie aus Datenschutzgründen nur im Portal.";

  const html = renderEmailLayout({
    preheader: `${treatment ?? "Neue Anfrage"} · ${input.receivedAtLabel} Uhr`,
    heading: "Neue Anfrage eingegangen",
    introHtml: `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 28px 0; letter-spacing:0.012em;">${escapeHtml(intro)}</p>`,
    cta: { label: "Anfrage im Portal öffnen", url: input.link },
    metaItems: [
      { icon: "clock", text: `${input.receivedAtLabel} Uhr` },
      { icon: "shield", text: input.sourceLabel },
    ],
    auditRows: [
      { label: "Behandlung", value: treatment ?? "Nicht angegeben" },
      { label: "Praxis", value: input.clinicName },
    ],
    fallbackUrl: input.link,
    footerLines: [
      "Benachrichtigung · EINS Portal",
      "Sie erhalten diese E-Mail, weil Sie im EINS Portal Ihrer Praxis eingetragen sind.",
    ],
  });

  const text = [
    "Neue Anfrage eingegangen",
    "",
    intro,
    "",
    `Behandlung: ${treatment ?? "Nicht angegeben"}`,
    `Quelle:     ${input.sourceLabel}`,
    `Eingang:    ${input.receivedAtLabel} Uhr`,
    `Praxis:     ${input.clinicName}`,
    "",
    `Anfrage im Portal öffnen: ${input.link}`,
  ].join("\n");

  return { subject, html, text };
}

export interface FirstInquiryCandidateInput {
  clinicName: string;
  messwegLabel: string;
  receivedAtLabel: string;
  /** Absolute link to the admin guarantee page of this Praxis. */
  adminLink: string;
}

/**
 * Operator mail to Karam: a Messweg inquiry arrived while the guarantee
 * clock of this Praxis is still open. It may trigger the first invoice, so
 * it needs a human check in /admin/garantie. No patient data either.
 */
export function renderFirstInquiryCandidateText(input: FirstInquiryCandidateInput): {
  subject: string;
  text: string;
} {
  return {
    subject: `Erste Anfrage prüfen: ${input.clinicName}`,
    text: [
      `Bei ${input.clinicName} ist eine Anfrage über einen EINS-Messweg eingegangen, während die 90-Tage-Frist noch offen ist.`,
      "",
      `Messweg: ${input.messwegLabel}`,
      `Eingang: ${input.receivedAtLabel} Uhr`,
      "",
      "Bitte prüfen und bestätigen oder ablehnen. Die bestätigte erste qualifizierte Anfrage löst die erste Rechnung aus.",
      "",
      `Garantie-Seite: ${input.adminLink}`,
    ].join("\n"),
  };
}
