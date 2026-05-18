/**
 * EINS Stimme — patient-facing review-request email.
 *
 * Tone: Sie-Form, warm, short. Subject line uses the Praxis name. Body
 * surfaces 5 rating buttons (1..5 ★) that all link to the same landing,
 * just with `?rating=N`. Compliance: every button leads to the same
 * landing surface that exposes BOTH the public review CTA AND the private
 * feedback form — never gated. The mail itself does NOT route 5-star
 * patients to Google directly. See apps/portal/docs/eins-stimme.md.
 *
 * Footer carries a one-click unsubscribe (§7 UWG Abs. 3 Nr. 2: "klar und
 * deutlich auf die Möglichkeit hinweisen, der Verwendung … zu widersprechen").
 */

export interface ReviewRequestRenderInput {
  clinicName: string;
  patientName: string | null;
  treatmentLabel: string | null;
  /** No trailing slash. */
  landingOrigin: string;
  /** Opaque request_recalls.review_token. */
  token: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderReviewRequestEmail(
  input: ReviewRequestRenderInput
): RenderedEmail {
  const greeting = input.patientName
    ? `Liebe Patientin, lieber Patient ${escape(input.patientName)},`
    : `Liebe Patientin, lieber Patient,`;

  const subject = `Wie war Ihr Besuch bei ${input.clinicName}?`;

  const ratingUrl = (n: number) =>
    `${input.landingOrigin}/r/${encodeURIComponent(input.token)}?rating=${n}`;
  const unsubUrl = `${input.landingOrigin}/r/unsubscribe?token=${encodeURIComponent(input.token)}`;

  const treatmentLine = input.treatmentLabel
    ? `<p style="margin:0 0 16px 0; font-size:15px; color:#4a4a52;">Anlass: ${escape(input.treatmentLabel)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color:#10101a; background:#f5f5f7; margin:0; padding:32px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4e4e7; border-radius:16px; padding:32px;">
    <div style="font-size:14px; letter-spacing:0.04em; color:#4a4a52; margin-bottom:24px;">${escape(input.clinicName)}</div>

    <h1 style="font-size:24px; font-weight:600; color:#10101a; margin:0 0 16px 0;">
      ${escape(greeting)}
    </h1>

    <p style="font-size:16px; line-height:1.55; color:#10101a; margin:0 0 12px 0;">
      vielen Dank für Ihren Besuch. Wir möchten unsere Arbeit Tag für Tag besser machen
      &mdash; Ihr ehrliches Feedback hilft uns dabei.
    </p>

    ${treatmentLine}

    <p style="font-size:15px; color:#10101a; margin:24px 0 12px 0;">
      Wie zufrieden waren Sie mit Ihrem Termin?
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
      <tr>
        ${[1, 2, 3, 4, 5]
          .map(
            (n) => `<td style="padding:0 4px;">
          <a href="${ratingUrl(n)}"
             style="display:inline-block; min-width:44px; text-align:center;
                    background:#10101a; color:#ffffff; font-weight:600;
                    padding:14px 16px; border-radius:12px; text-decoration:none;
                    font-size:15px;">
            ${n}&nbsp;★
          </a>
        </td>`
          )
          .join("")}
      </tr>
    </table>

    <p style="font-size:13px; color:#4a4a52; margin:8px 0 0 0;">
      1&nbsp;= sehr unzufrieden &nbsp;·&nbsp; 5&nbsp;= sehr zufrieden
    </p>

    <p style="font-size:15px; line-height:1.55; color:#10101a; margin:32px 0 0 0;">
      Sie können auf der folgenden Seite zwischen einer öffentlichen Bewertung
      und einer privaten Rückmeldung an die Praxis wählen &mdash; ganz, wie es Ihnen lieber ist.
    </p>

    <hr style="border:none; border-top:1px solid #e4e4e7; margin:32px 0;">
    <div style="font-size:12px; color:#8a8a94; line-height:1.5;">
      Sie erhalten diese E-Mail, weil Sie kürzlich Patient:in bei
      ${escape(input.clinicName)} waren. Möchten Sie keine weiteren
      Erinnerungen erhalten?
      <a href="${unsubUrl}" style="color:#10101a;">Hier abmelden</a>.
    </div>
  </div>
</body></html>`;

  const text = [
    greeting,
    "",
    `vielen Dank für Ihren Besuch bei ${input.clinicName}.`,
    "Ihr Feedback hilft uns, unsere Arbeit besser zu machen.",
    input.treatmentLabel ? `Anlass: ${input.treatmentLabel}` : "",
    "",
    "Wie zufrieden waren Sie mit Ihrem Termin?",
    "",
    `1 Stern:  ${ratingUrl(1)}`,
    `2 Sterne: ${ratingUrl(2)}`,
    `3 Sterne: ${ratingUrl(3)}`,
    `4 Sterne: ${ratingUrl(4)}`,
    `5 Sterne: ${ratingUrl(5)}`,
    "",
    "Auf der folgenden Seite können Sie zwischen einer öffentlichen Bewertung",
    "und einer privaten Rückmeldung an die Praxis wählen.",
    "",
    "—",
    `Keine weiteren E-Mails erhalten: ${unsubUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

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
