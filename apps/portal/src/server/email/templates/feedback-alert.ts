import { escapeHtml } from "@/server/email";
/**
 * EINS Bewertungen — alert mail to the Praxisinhaber:in when a patient submits
 * private feedback via the rating landing.
 *
 * Why this template: the patient_feedback inbox lives at /bewertungen/feedback in the
 * portal, but the Inhaber:in shouldn't have to babysit it. This mail
 * surfaces the rating and the callback wish and deep-links to the inbox.
 * Patient name, email and free text are deliberately NOT rendered (the inbox
 * can be an external address; patient data stays behind the portal login).
 * The input still carries them so callers need no change.
 */

export interface FeedbackAlertRenderInput {
  clinicName: string;
  portalOrigin: string;
  feedbackId: string;
  rating: number;
  freeText: string | null;
  patientName: string | null;
  patientEmail: string | null;
  contactBackOk: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const RATING_TONE: Record<number, string> = {
  1: "kritisch",
  2: "kritisch",
  3: "ausbaufähig",
  4: "positiv",
  5: "sehr positiv",
};

export function renderFeedbackAlertEmail(
  input: FeedbackAlertRenderInput
): RenderedEmail {
  const tone = RATING_TONE[input.rating] ?? "neu";
  const subject = `Neue Rückmeldung eines Patienten (${input.rating} ★, ${tone}): ${input.clinicName}`;

  const link = `${input.portalOrigin.replace(/\/$/, "")}/bewertungen/feedback/${encodeURIComponent(input.feedbackId)}`;

  const contactLine = input.contactBackOk
    ? "<strong>Rückruf gewünscht.</strong> Name, Kontakt und Nachricht finden Sie im Portal."
    : "Kein ausdrücklicher Rückrufwunsch. Bitte die Person nicht ungefragt kontaktieren.";

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color:#10101a; background:#f5f5f7; margin:0; padding:32px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4e4e7; border-radius:16px; padding:32px;">
    <div style="font-size:14px; letter-spacing:0.04em; color:#4a4a52; margin-bottom:16px;">${escapeHtml(input.clinicName)}</div>

    <h1 style="font-size:22px; font-weight:600; margin:0 0 8px 0;">
      Neue private Rückmeldung: ${input.rating} ★
    </h1>
    <p style="margin:0 0 16px 0; font-size:14px; color:#4a4a52;">
      ${input.freeText ? "Mit Nachricht." : "Ohne Nachricht."} Aus Datenschutzgründen steht der Inhalt nur im Portal.
    </p>

    <p style="margin:16px 0; font-size:14px;">${contactLine}</p>

    <p style="margin:32px 0;">
      <a href="${link}"
         style="display:inline-block; background:#10101a; color:#ffffff; font-weight:600;
                padding:14px 24px; border-radius:12px; text-decoration:none; font-size:15px;">
        Im Portal öffnen
      </a>
    </p>

    <hr style="border:none; border-top:1px solid #e4e4e7; margin:32px 0;">
    <div style="font-size:12px; color:#8a8a94; line-height:1.5;">
      Sie erhalten diese E-Mail, weil Patienten vertrauliche
      Rückmeldungen an Ihre Praxis schicken. Verwaltung und Abmeldung
      unter „Einstellungen &rsaquo; Bewertungen &amp; Reputation" im Portal.
    </div>
  </div>
</body></html>`;

  const text = [
    `Neue Rückmeldung eines Patienten (${input.rating} ★)`,
    `Praxis: ${input.clinicName}`,
    "",
    input.contactBackOk
      ? "Rückruf gewünscht."
      : "Kein Rückruf gewünscht.",
    input.freeText ? "Mit Nachricht." : "Ohne Nachricht.",
    "Aus Datenschutzgründen stehen Name, Kontakt und Nachricht nur im Portal.",
    "",
    `Im Portal öffnen: ${link}`,
  ].join("\n");

  return { subject, html, text };
}
