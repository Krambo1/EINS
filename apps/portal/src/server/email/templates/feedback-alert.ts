/**
 * EINS Bewertungen — alert mail to the Praxisinhaber:in when a patient submits
 * private feedback via the rating landing.
 *
 * Why this template: the patient_feedback inbox lives at /bewertungen/feedback in the
 * portal, but the Inhaber:in shouldn't have to babysit it. This mail
 * surfaces the rating + text inline so they can decide on the spot whether
 * to call back, and deep-links them to the inbox for triage.
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
  const subject = `Neue Patient:innen-Rückmeldung (${input.rating} ★ – ${tone}): ${input.clinicName}`;

  const link = `${input.portalOrigin.replace(/\/$/, "")}/bewertungen/feedback/${encodeURIComponent(input.feedbackId)}`;

  const contactLine = input.contactBackOk
    ? "<strong>Rückruf gewünscht.</strong>"
    : "Kein expliziter Rückrufwunsch — bitte Patient:in nicht ungefragt kontaktieren.";

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color:#10101a; background:#f5f5f7; margin:0; padding:32px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4e4e7; border-radius:16px; padding:32px;">
    <div style="font-size:14px; letter-spacing:0.04em; color:#4a4a52; margin-bottom:16px;">${escape(input.clinicName)}</div>

    <h1 style="font-size:22px; font-weight:600; margin:0 0 8px 0;">
      Neue private Rückmeldung &mdash; ${input.rating} ★
    </h1>
    <p style="margin:0 0 16px 0; font-size:14px; color:#4a4a52;">
      ${escape(input.patientName ?? "Ohne Namen")}${
        input.patientEmail ? ` · ${escape(input.patientEmail)}` : ""
      }
    </p>

    ${
      input.freeText
        ? `<blockquote style="border-left:3px solid #58BAB5; padding-left:16px; margin:16px 0; color:#10101a; font-size:15px; line-height:1.55; white-space:pre-wrap;">
${escape(input.freeText)}
</blockquote>`
        : `<p style="font-style:italic; color:#8a8a94; margin:16px 0;">Keine Freitext-Rückmeldung.</p>`
    }

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
      Sie erhalten diese E-Mail, weil Patient:innen vertrauliche
      Rückmeldungen an Ihre Praxis schicken. Verwaltung und Abmeldung
      unter „Einstellungen &rsaquo; Bewertungen &amp; Reputation" im Portal.
    </div>
  </div>
</body></html>`;

  const text = [
    `Neue Patient:innen-Rückmeldung (${input.rating} ★)`,
    `Praxis: ${input.clinicName}`,
    "",
    `Von: ${input.patientName ?? "Ohne Namen"}${
      input.patientEmail ? ` <${input.patientEmail}>` : ""
    }`,
    input.contactBackOk
      ? "Rückruf gewünscht."
      : "Kein Rückruf gewünscht.",
    "",
    input.freeText ? input.freeText : "(Keine Freitext-Rückmeldung)",
    "",
    `Im Portal öffnen: ${link}`,
  ].join("\n");

  return { subject, html, text };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
