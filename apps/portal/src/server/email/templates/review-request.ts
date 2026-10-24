/**
 * EINS Bewertungen: patient-facing review-request email.
 *
 * Redesigned 2026-10-10 for completion, not decoration. The practice is the
 * sender, the question is the headline, and the five stars are the only
 * action. Visit card, EINS logo and long copy are gone.
 *
 *   - practice name (small), greeting, one line of thanks
 *   - headline "Wie zufrieden waren Sie?" plus "Ein Klick auf einen Stern genügt."
 *   - five star boxes, each linking to /r/<token>?rating=N
 *   - scale legend, sign-off from the practice team
 *   - under the card: why this mail, one-click unsubscribe, "Versand über EINS"
 *
 * Every patient gets the same mail. The landing page routes by stars: 4 and
 * 5 open the public review at once, 1 to 3 get a message form for the
 * practice (Karam's decision of 2026-10-10, see docs/eins-bewertungen.md).
 * Treatment and treating doctor are not shown: a review request needs
 * neither, and an inbox is not always private.
 *
 * Stars are the glyph ★ (U+2605) in a bordered table cell, not an image:
 * Gmail does not show SVG images, and a glyph needs no hosted asset. The
 * border sits on the <td> so Outlook desktop draws the box too.
 *
 * Email-client constraints: inline styles only, table layout, no flex/grid,
 * no em dashes (Karam's style rule). The one-click unsubscribe link
 * satisfies §7 Abs. 3 Nr. 2 UWG and RFC 8058.
 */

import "server-only";
import { escapeHtml } from "@/server/email";

export interface ReviewRequestRenderInput {
  /** Praxis display name. The visible sender of the whole email. */
  clinicName: string;
  /** First name for greeting. Null = generic salutation. */
  patientName: string | null;
  /** Treatment label captured at intake. Not rendered (see header). */
  treatmentLabel: string | null;
  /** The actual appointment date (= patient_event.appointmentCompletedAt). */
  appointmentDate?: Date | null;
  /** Not rendered since the 2026-10-10 redesign; kept for callers. */
  practiceSpecialty?: string | null;
  /** Not rendered since the 2026-10-10 redesign; kept for callers. */
  practiceLocation?: string | null;
  /** Not rendered since the 2026-10-10 redesign; kept for callers. */
  practitionerName?: string | null;
  /** No trailing slash. */
  landingOrigin: string;
  /** Opaque review_email_schedule.review_token. */
  token: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  ink: "#10101a",
  muted: "#6a6a74",
  faint: "#8e8e97",
  page: "#f4f4f6",
  card: "#ffffff",
  border: "#e4e4e7",
  starBox: "#fafafb",
  star: "#F5B400",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const;

/**
 * German date in Europe/Berlin, so a UTC timestamp from the PMS resolves to
 * the local day the patient remembers. "10. Oktober" or "10. Oktober 2026".
 */
function formatVisitDate(d: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(d);
}

export function renderReviewRequestEmail(
  input: ReviewRequestRenderInput
): RenderedEmail {
  const name = input.patientName?.trim() || null;
  const clinic = input.clinicName;

  const subject = name
    ? `${name}, wie war Ihr Besuch bei ${clinic}?`
    : `Wie war Ihr Besuch bei ${clinic}?`;
  const greeting = name ? `Hallo ${name},` : "Guten Tag,";
  const thanks = input.appointmentDate
    ? `danke für Ihren Besuch am ${formatVisitDate(input.appointmentDate, false)}.`
    : "danke für Ihren Besuch.";
  const question = "Wie zufrieden waren Sie?";
  const hint = "Ein Klick auf einen Stern genügt.";
  const reason = input.appointmentDate
    ? `Sie erhalten diese E-Mail, weil Sie am ${formatVisitDate(input.appointmentDate, true)} einen Termin bei ${clinic} hatten.`
    : `Sie erhalten diese E-Mail, weil Sie kürzlich einen Termin bei ${clinic} hatten.`;

  const token = encodeURIComponent(input.token);
  const ratingUrl = (n: number) => `${input.landingOrigin}/r/${token}?rating=${n}`;
  const unsubUrl = `${input.landingOrigin}/r/unsubscribe?token=${token}`;

  const p = (style: string, html: string) =>
    `<p style="margin:0; ${style}">${html}</p>`;

  const cardInnerHtml =
    p(`font-size:13px; line-height:1.4; font-weight:600; color:${C.muted}; padding-bottom:22px;`, escapeHtml(clinic)) +
    p(`font-size:16px; line-height:1.55; color:${C.ink}; padding-bottom:22px;`, `${escapeHtml(greeting)}<br>${escapeHtml(thanks)}`) +
    `<h1 style="margin:0; font-size:24px; line-height:1.25; font-weight:700; color:${C.ink};">${escapeHtml(question)}</h1>` +
    p(`font-size:15px; line-height:1.5; color:${C.muted}; padding:6px 0 20px 0;`, escapeHtml(hint)) +
    renderStars(ratingUrl) +
    renderScaleLegend() +
    p(`font-size:15px; line-height:1.55; color:${C.ink}; padding-top:30px;`, `Herzliche Grüße<br>Ihr Praxisteam<br>${escapeHtml(clinic)}`);

  const footerHtml =
    `${escapeHtml(reason)} Keine weiteren E-Mails dieser Art? ` +
    `<a href="${escapeHtml(unsubUrl)}" style="color:${C.muted}; text-decoration:underline;">Hier abmelden</a>.<br>` +
    `Versand über EINS im Auftrag der Praxis.`;

  const html = renderShell({ preheader: hint, title: subject, cardInnerHtml, footerHtml });

  const text = [
    clinic,
    "",
    greeting,
    thanks,
    "",
    `${question} ${hint}`,
    "",
    `1 Stern (sehr unzufrieden):  ${ratingUrl(1)}`,
    `2 Sterne:                    ${ratingUrl(2)}`,
    `3 Sterne:                    ${ratingUrl(3)}`,
    `4 Sterne:                    ${ratingUrl(4)}`,
    `5 Sterne (sehr zufrieden):   ${ratingUrl(5)}`,
    "",
    "Herzliche Grüße",
    "Ihr Praxisteam",
    clinic,
    "",
    `${reason} Keine weiteren E-Mails dieser Art: ${unsubUrl}`,
    "Versand über EINS im Auftrag der Praxis.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Five tappable boxes, 46px each with 3px gutters (260px in total), so the
 * row fits a 320px phone inside the card padding. The whole box is the link
 * in every client except Outlook desktop, where the glyph is.
 */
function renderStars(href: (n: number) => string): string {
  const cells = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td style="padding:0 3px;">` +
          `<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>` +
            `<td width="44" height="44" align="center" valign="middle" style="width:44px; height:44px; background:${C.starBox}; border:1px solid ${C.border}; border-radius:12px; mso-line-height-rule:exactly;">` +
              `<a href="${escapeHtml(href(n))}" aria-label="${n} von 5 Sternen" ` +
              `style="display:block; width:44px; height:44px; line-height:44px; font-size:26px; color:${C.star}; text-decoration:none; text-align:center; mso-line-height-rule:exactly;">&#9733;</a>` +
            `</td>` +
          `</tr></table>` +
        `</td>`
    )
    .join("");
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0;"><tr>${cells}</tr></table>`;
}

function renderScaleLegend(): string {
  const cell = (align: "left" | "right", label: string) =>
    `<td width="50%" align="${align}" style="padding-top:8px; font-size:12px; line-height:1.4; color:${C.faint};">${label}</td>`;
  return (
    `<table role="presentation" width="260" border="0" cellspacing="0" cellpadding="0" style="width:260px; margin:0;"><tr>` +
      cell("left", "1&nbsp;=&nbsp;sehr unzufrieden") +
      cell("right", "5&nbsp;=&nbsp;sehr zufrieden") +
    `</tr></table>`
  );
}

interface ShellInput {
  preheader: string;
  title: string;
  cardInnerHtml: string;
  footerHtml: string;
}

function renderShell({ preheader, title, cardInnerHtml, footerHtml }: ShellInput): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<!--[if mso]>
<style>
  table, td, p, a, h1 { font-family: Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0; padding:0; background:${C.page}; color:${C.ink}; font-family:${C.font}; -webkit-font-smoothing:antialiased;">
<div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${C.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="520" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:520px;">
<tr><td style="background:${C.card}; border:1px solid ${C.border}; border-radius:18px; padding:32px 24px 30px 24px; font-family:${C.font};">
${cardInnerHtml}
</td></tr>
<tr><td style="padding:16px 8px 0 8px; font-size:12px; line-height:1.55; color:${C.faint}; font-family:${C.font};">
${footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
