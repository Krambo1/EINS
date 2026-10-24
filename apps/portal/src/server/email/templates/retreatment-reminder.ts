/**
 * Wiederbehandlungs-Kalender: the one reminder a patient gets when her next
 * session is about due.
 *
 * Deliberately neutral, and the reasons are legal, not stylistic:
 *   - No treatment name, no price, no offer. The mail is advertising under
 *     § 7 UWG, and naming the treatment would put health data (Art. 9 DSGVO)
 *     into a mailbox the patient may share; promo wording would add HWG risk.
 *   - Every mail carries the objection notice § 7 Abs. 3 Nr. 4 UWG requires,
 *     plus a one-click unsubscribe link (List-Unsubscribe is set by the tick).
 *   - The Praxis is the visible sender; EINS is named once, small, as the
 *     sending service.
 *
 * Inline styles + table layout only (Gmail/Outlook strip <style>). No
 * em-dashes (Karam style rule).
 */

import "server-only";
import { escapeHtml } from "@/server/email";

export interface RetreatmentReminderRenderInput {
  clinicName: string;
  /** Full name for the greeting; null = "Guten Tag,". */
  patientName: string | null;
  /** "etwa 3 Monate", from sinceLastVisitPhrase(). */
  sincePhrase: string;
  /** Token redirect that records the click and forwards to the booking page. Null = phone only. */
  bookingUrl: string | null;
  phone: string | null;
  unsubscribeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  fgPrimary: "#10101a",
  fgSecondary: "#4a4a52",
  fgTertiary: "#6a6a74",
  bgPage: "#f2f2f4",
  bgCard: "#ffffff",
  border: "#e4e4e7",
  fontStack:
    "'Neue Haas Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const;

export function renderRetreatmentReminderEmail(
  input: RetreatmentReminderRenderInput
): RenderedEmail {
  const clinic = input.clinicName.trim();
  const name = input.patientName?.trim() || null;
  const subject = `Ihr nächster Termin bei ${clinic}`;
  const greeting = name ? `Guten Tag ${name},` : "Guten Tag,";
  const intro = `Ihr letzter Besuch bei ${clinic} liegt ${input.sincePhrase} zurück.`;
  const ask = input.bookingUrl
    ? "Wenn Sie einen neuen Termin vereinbaren möchten, können Sie ihn hier direkt buchen:"
    : "Wenn Sie einen neuen Termin vereinbaren möchten, rufen Sie uns gerne an:";
  const phoneLine = input.phone
    ? input.bookingUrl
      ? `Oder rufen Sie uns an: ${input.phone}`
      : input.phone
    : null;
  const ignore = "Falls Sie schon einen Termin haben, können Sie diese E-Mail einfach ignorieren.";
  const objection =
    `Sie erhalten diese E-Mail, weil Sie Patientin oder Patient bei ${clinic} sind. ` +
    "Sie können der Verwendung Ihrer E-Mail-Adresse für solche Erinnerungen jederzeit widersprechen, " +
    "ohne dass Ihnen dafür andere als die Übermittlungskosten nach den Basistarifen entstehen.";

  const e = escapeHtml;
  const p = (body: string, color: string = C.fgPrimary, extra = "") =>
    `<p style="margin:0 0 16px 0; font-size:16px; line-height:1.55; color:${color}; ${extra}">${body}</p>`;

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0; padding:0; background:${C.bgPage}; font-family:${C.fontStack};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bgPage};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; background:${C.bgCard}; border:1px solid ${C.border}; border-radius:16px;">
      <tr><td style="padding:32px;">
        <p style="margin:0 0 24px 0; font-size:20px; font-weight:600; color:${C.fgPrimary};">${e(clinic)}</p>
        ${p(e(greeting))}
        ${p(e(intro))}
        ${p(e(ask))}
        ${
          input.bookingUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="border-radius:12px; background:${C.fgPrimary};">
          <a href="${e(input.bookingUrl)}" style="display:inline-block; padding:14px 24px; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:12px;">Termin buchen</a>
        </td></tr></table>`
            : ""
        }
        ${phoneLine ? p(e(phoneLine), C.fgPrimary, "font-weight:600;") : ""}
        ${p(e(ignore), C.fgSecondary)}
        ${p(`Freundliche Grüße<br>Ihr Praxisteam<br>${e(clinic)}`, C.fgPrimary, "margin-bottom:0;")}
      </td></tr>
      <tr><td style="padding:0 32px 32px 32px;">
        <div style="border-top:1px solid ${C.border}; padding-top:16px; font-size:13px; line-height:1.5; color:${C.fgTertiary};">
          ${e(objection)}
          <a href="${e(input.unsubscribeUrl)}" style="color:${C.fgTertiary}; text-decoration:underline;">Erinnerungen abbestellen</a>.
        </div>
      </td></tr>
    </table>
    <p style="margin:16px 0 0 0; font-size:12px; color:${C.fgTertiary};">Versendet über EINS im Auftrag von ${e(clinic)}.</p>
  </td></tr>
</table>
</body></html>`;

  const text = [
    greeting,
    "",
    intro,
    ask,
    input.bookingUrl ? input.bookingUrl : null,
    phoneLine,
    "",
    ignore,
    "",
    "Freundliche Grüße",
    "Ihr Praxisteam",
    clinic,
    "",
    "--",
    objection,
    `Erinnerungen abbestellen: ${input.unsubscribeUrl}`,
    "",
    `Versendet über EINS im Auftrag von ${clinic}.`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject, html, text };
}
