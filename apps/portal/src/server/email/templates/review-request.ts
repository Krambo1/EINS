/**
 * EINS Stimme — patient-facing review-request email.
 *
 * Rebuilt 2026-05-28 from the actual Claude Design handoff bundle
 * (D:\Desktop\review-e-mail\project\Review E-Mail.html — Karam's
 * approved direction). Visual vocabulary differs from the admin email
 * family (magic-link / monthly-report / feedback): the Praxis is the
 * visible sender here, EINS is the (small, transparent) infrastructure
 * mention. Because the structure is fundamentally different from
 * `renderEmailLayout` (no EINS PNG above the card, footer INSIDE the
 * card, practice lockup instead of the EINS header), this template
 * writes its own bulletproof HTML.
 *
 * Structure, top to bottom:
 *
 *   - Outer page on soft-gray #f2f2f4
 *   - 640px white card, 20px radius, soft shadow
 *     - Tiny brand row: small EINS logo + "Versendet im Auftrag Ihrer Praxis"
 *     - Practice lockup: Praxisname (22px / 600) + optional "Fachrichtung · Standort"
 *     - H1 greeting: "Liebe Patientin, lieber Patient <Vorname>," — 28px / 600
 *     - Body paragraph: "vielen Dank für Ihren Besuch{ am <Datum>} in der <Praxis>…"
 *     - Visit summary 3-col card (Datum | Behandlung | Behandelt von) when data present
 *     - Rating prompt: "Wie zufrieden waren Sie mit Ihrer <Behandlung> in der <Praxis>?"
 *     - 5 LEFT-aligned outlined-gray stars (Unicode ☆ U+2606 at 56px, color
 *       #d1d1d6). Each is a separate <a> linking to /r/<token>?rating=N.
 *     - Scale legend: "1  sehr unzufrieden" ←→ "5  sehr zufrieden" justify-between
 *     - Follow-up paragraph: explicit compliant funnel statement
 *     - Hairline divider
 *     - Footer (inside card): "Sie erhalten diese E-Mail, weil Sie am
 *       <Datum> Patient:in in der <Praxis> waren. … Hier abmelden."
 *   - Sent-meta UNDER the card: "Versendet über EINS · Antworten landen
 *     direkt in Ihrer Praxis-Inbox."
 *
 * Compliance still holds: every star (1..5) links to the same
 * /r/<token>?rating=N URL, which renders BOTH the public review CTA AND
 * the private feedback form. The mail itself does NOT route 5-star
 * patients to Google directly. See apps/portal/docs/eins-stimme.md.
 * The one-click "Hier abmelden" link in the footer satisfies §7 UWG
 * Abs. 3 Nr. 2 + RFC 8058 (one-click unsubscribe).
 *
 * Email-client constraints honored:
 *   - inline styles only (Gmail / Outlook strip <style>)
 *   - table-based scaffolding throughout so Outlook (Word renderer)
 *     holds layout — no display:flex / grid
 *   - PNG logo (SVG would be stripped by Gmail / Outlook desktop)
 *   - Unicode ☆ (U+2606) for stars — renders natively, no image dep
 *   - mso-line-height-rule:exactly on the star anchor so Outlook
 *     doesn't inflate the line box and crop the glyph
 *   - no em-dashes anywhere (Karam style preference)
 */

import "server-only";
import { emailLogoUrl, emailStarUrl } from "@/lib/env";
import { escapeHtml } from "@/server/email";

export interface ReviewRequestRenderInput {
  /** Praxis display name. The customer-facing brand of the whole email. */
  clinicName: string;
  /** First name for greeting. Null = generic salutation. */
  patientName: string | null;
  /** Treatment label captured at intake. Appears in body intro AND visit card. */
  treatmentLabel: string | null;
  /**
   * The actual appointment date (= patient_event.appointmentCompletedAt).
   * When present, body intro reads "vielen Dank für Ihren Besuch am
   * <Datum>" and the visit card shows the date cell + footer reminder
   * phrase resolves with the date.
   */
  appointmentDate?: Date | null;
  /**
   * Praxis specialty for the lockup sub-line (e.g. "Ästhetische Medizin",
   * "Hautärztliche Praxis"). Optional. Not yet plumbed from the schema —
   * future schema work would add this to the `clinics` table. The
   * renderer just drops the sub-line when both this and `practiceLocation`
   * are absent.
   */
  practiceSpecialty?: string | null;
  /**
   * City / location label (e.g. "Düsseldorf"). Optional. Same plumbing
   * note as `practiceSpecialty`.
   */
  practiceLocation?: string | null;
  /**
   * Surname of the treating doctor (rendered as "Dr. <Name>" in the
   * visit card). Optional. Future schema work would persist this from
   * the patient_event payload onto `review_email_schedule`.
   */
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

// Design tokens — match the design bundle's colors_and_type.css 1:1.
// Kept literal so this file is standalone-readable. Anything visual MUST
// come from this list (or be a one-off rgba alongside an explanation).
const C = {
  accent: "#58BAB5",
  fgPrimary: "#10101a",
  fgSecondary: "#4a4a52",
  fgTertiary: "#6a6a74",
  // Soft-gray page bg from the design (slightly cooler than the admin family).
  bgPage: "#f2f2f4",
  bgCard: "#ffffff",
  // bg-secondary @ 70% in the design's .visit card. Email clients aren't
  // consistent with rgba on td background — use the flat #f7f7f9 approximation
  // (= #f5f5f7 lifted toward white by ~3pp lightness).
  bgVisit: "#f7f7f9",
  border: "#e4e4e7",
  borderHover: "#d1d1d6", // empty-star stroke color
  radius2xl: "20px",
  radiusLg: "14px",
  fontStack:
    "'Neue Haas Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const;

// Cards take a single composite shadow in the design. Inline rgba is fine
// across modern clients; Outlook strips it (graceful — border still defines
// the card edge).
const SHADOW_CARD =
  "0 1px 2px rgba(16,16,26,0.05), 0 6px 18px -4px rgba(16,16,26,0.08), 0 24px 48px -22px rgba(16,16,26,0.10)";

/**
 * Format an appointment date for German body copy: "16. Mai 2026".
 * Europe/Berlin so a UTC timestamp from the PMS resolves to the local
 * date the patient experienced (a 22:30 UTC appointment is 00:30 the
 * NEXT day in Berlin during DST — the patient remembers the local date).
 */
function formatVisitDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return fmt.format(d);
}

export function renderReviewRequestEmail(
  input: ReviewRequestRenderInput
): RenderedEmail {
  // ---- Derived strings ------------------------------------------------------

  const subject = `Wie war Ihr Besuch bei ${input.clinicName}?`;

  // Greeting IS the H1 in this design.
  const greeting = input.patientName
    ? `Liebe Patientin, lieber Patient ${input.patientName},`
    : `Liebe Patientin, lieber Patient,`;

  // Body intro adapts to whether we have an appointment date.
  const visitDateLabel = input.appointmentDate
    ? formatVisitDate(input.appointmentDate)
    : null;
  const bodyIntroText = visitDateLabel
    ? `vielen Dank für Ihren Besuch am ${visitDateLabel} in der ${input.clinicName}. Wir möchten unsere Arbeit Tag für Tag besser machen. Ihr ehrliches Feedback zu Ihrer Behandlung hilft uns dabei.`
    : `vielen Dank für Ihren Besuch in der ${input.clinicName}. Wir möchten unsere Arbeit Tag für Tag besser machen. Ihr ehrliches Feedback zu Ihrer Behandlung hilft uns dabei.`;

  // Rating prompt also adapts: with treatment label we get the personal
  // phrasing the design specs; without it, fall back to a clean generic.
  const ratingPromptText = input.treatmentLabel
    ? `Wie zufrieden waren Sie mit Ihrer ${input.treatmentLabel} in der ${input.clinicName}?`
    : `Wie zufrieden waren Sie mit Ihrem Besuch in der ${input.clinicName}?`;

  // Footer reminder phrase — date when present.
  const footerReminder = visitDateLabel
    ? `Sie erhalten diese E-Mail, weil Sie am ${visitDateLabel} Patient:in in der ${input.clinicName} waren.`
    : `Sie erhalten diese E-Mail, weil Sie kürzlich Patient:in in der ${input.clinicName} waren.`;

  // ---- URLs ----------------------------------------------------------------

  const ratingUrl = (n: number) =>
    `${input.landingOrigin}/r/${encodeURIComponent(input.token)}?rating=${n}`;
  const unsubUrl = `${input.landingOrigin}/r/unsubscribe?token=${encodeURIComponent(input.token)}`;
  const logoUrl = emailLogoUrl();
  const starUrl = emailStarUrl();

  // ---- Practice lockup sub (Fachrichtung · Standort) -----------------------

  const lockupSubParts: string[] = [];
  if (input.practiceSpecialty) lockupSubParts.push(input.practiceSpecialty);
  if (input.practiceLocation) lockupSubParts.push(input.practiceLocation);
  const lockupSub =
    lockupSubParts.length > 0
      ? lockupSubParts.map((s) => escapeHtml(s)).join(" &middot; ")
      : null;

  // ---- Visit summary 3-col card --------------------------------------------
  // Show only when at least one of date / treatment / practitioner is present.
  // For empty cells we render an em-dash-free placeholder (long Unicode
  // "horizontal ellipsis" U+2026 = "…") so the grid stays visually balanced.
  // Per Karam's "no em-dash" rule, "—" is forbidden everywhere.

  const visitCells: Array<{ label: string; value: string }> = [];
  if (visitDateLabel) visitCells.push({ label: "Datum", value: visitDateLabel });
  if (input.treatmentLabel)
    visitCells.push({ label: "Behandlung", value: input.treatmentLabel });
  if (input.practitionerName)
    visitCells.push({
      label: "Behandelt von",
      value: `Dr. ${input.practitionerName}`,
    });
  const showVisitCard = visitCells.length > 0;

  const visitCardHtml = showVisitCard
    ? renderVisitCard(visitCells)
    : "";

  // ---- Star row -------------------------------------------------------------
  // Five Unicode ☆ glyphs at 56px, color border-hover. Left-aligned, gap 6px
  // (4px cell padding + space between glyph and next anchor). Each ☆ is the
  // entire <a> body — no surrounding tile — to match the design's stroke-only
  // look. Anchor padding (4px) gives a 64×64 hit target that's still WCAG-
  // compliant on touch.

  const starsHtml = renderStars((n) => ratingUrl(n), starUrl);

  // ---- Compose body --------------------------------------------------------

  const cardInnerHtml =
    renderBrandRow(logoUrl) +
    renderPracticeLockup(input.clinicName, lockupSub) +
    renderGreeting(greeting) +
    renderBody(bodyIntroText) +
    visitCardHtml +
    renderRatingPrompt(ratingPromptText) +
    starsHtml +
    renderScaleLegend() +
    renderFollowup() +
    renderDivider() +
    renderFooter(footerReminder, unsubUrl);

  const html = renderShell({
    preheader: `Vielen Dank für Ihren Besuch bei ${input.clinicName}. Wir freuen uns über eine kurze Rückmeldung.`,
    title: subject,
    cardInnerHtml,
  });

  // ---- Plaintext -----------------------------------------------------------

  const bareLandingUrl = `${input.landingOrigin}/r/${encodeURIComponent(input.token)}`;

  const text = [
    `Im Auftrag von ${input.clinicName}`,
    "",
    greeting,
    "",
    bodyIntroText,
    "",
    visitDateLabel ? `Datum:         ${visitDateLabel}` : "",
    input.treatmentLabel ? `Behandlung:    ${input.treatmentLabel}` : "",
    input.practitionerName ? `Behandelt von: Dr. ${input.practitionerName}` : "",
    "",
    ratingPromptText,
    "",
    `1 Stern  (sehr unzufrieden):  ${ratingUrl(1)}`,
    `2 Sterne:                     ${ratingUrl(2)}`,
    `3 Sterne:                     ${ratingUrl(3)}`,
    `4 Sterne:                     ${ratingUrl(4)}`,
    `5 Sterne (sehr zufrieden):    ${ratingUrl(5)}`,
    "",
    `Lieber direkt schreiben? ${bareLandingUrl}`,
    "",
    "Auf der folgenden Seite können Sie selbst wählen, ob Ihre Rückmeldung",
    "öffentlich (Google / Jameda) oder privat an die Praxis gehen soll.",
    "",
    `${footerReminder} Keine weiteren Erinnerungen erhalten: ${unsubUrl}`,
    "",
    "Versendet über EINS. Antworten landen direkt in Ihrer Praxis-Inbox.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Render helpers (kept tightly scoped to this template — no need to live in
// the shared layout file).
// ---------------------------------------------------------------------------

function renderBrandRow(logoUrl: string): string {
  // Small EINS logo + tiny "Versendet im Auftrag Ihrer Praxis" label. Single
  // row, vertical-align middle. Opacity isn't reliable cross-client; we ship
  // the logo at its native black and let it read as a small infra mark.
  return (
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 18px 0;">` +
      `<tr>` +
        `<td valign="middle" style="padding-right:8px; mso-line-height-rule:exactly;">` +
          `<img src="${escapeHtml(logoUrl)}" alt="EINS" width="35" height="14" style="display:block; width:35px; height:14px; border:0; outline:none; text-decoration:none;">` +
        `</td>` +
        `<td valign="middle" style="font-size:12px; line-height:1; color:${C.fgTertiary}; letter-spacing:0.012em; mso-line-height-rule:exactly;">` +
          `Versendet im Auftrag Ihrer Praxis` +
        `</td>` +
      `</tr>` +
    `</table>`
  );
}

function renderPracticeLockup(name: string, sub: string | null): string {
  const subHtml = sub
    ? `<div style="font-size:13px; line-height:1.3; color:${C.fgTertiary}; letter-spacing:0.012em; margin-top:4px;">${sub}</div>`
    : "";
  return (
    `<div style="margin:0 0 36px 0;">` +
      `<div style="font-size:22px; line-height:1.15; font-weight:600; letter-spacing:-0.005em; color:${C.fgPrimary};">${escapeHtml(name)}</div>` +
      subHtml +
    `</div>`
  );
}

function renderGreeting(greeting: string): string {
  // H1 = the greeting itself, per the design.
  return `<h1 style="font-size:28px; line-height:1.15; font-weight:600; letter-spacing:-0.005em; color:${C.fgPrimary}; margin:0 0 20px 0;">${escapeHtml(greeting)}</h1>`;
}

function renderBody(text: string): string {
  return `<p style="font-size:15.5px; line-height:1.6; color:${C.fgPrimary}; margin:0 0 18px 0; letter-spacing:0.005em;">${escapeHtml(text)}</p>`;
}

function renderVisitCard(
  cells: Array<{ label: string; value: string }>
): string {
  // 3-col table where each column is a SINGLE <td> containing the label and
  // value stacked. Single-cell-per-column is the trick that makes the
  // vertical separator render as one continuous line (a 2-row layout would
  // show a 4px gap between the label-row border and the value-row border).
  //
  // Border treatment: each non-first cell carries a 1px left border in the
  // card's border color. Cells get symmetric horizontal padding (18px L/R)
  // so the content sits a consistent distance from each separator.
  // valign top on every cell so unequal text lengths don't bottom-align.
  //
  // Outlook (Word renderer): `border-left` on <td> is honored, but
  // `border-radius` on the outer table isn't — the visit card degrades to a
  // square-cornered rectangle there, still legible.
  //
  // Caller has already filtered out missing cells; we render in order.

  const colWidth = Math.floor(100 / cells.length);

  const innerCells = cells
    .map((c, i) => {
      // First cell has no left border and no left padding (its left edge IS
      // the card's left padding). Subsequent cells get a 1px left border +
      // 18px left padding so the content has breathing room from the line.
      const leftBorder =
        i > 0 ? `border-left:1px solid ${C.border}; ` : "";
      const padLeft = i > 0 ? "18px" : "0";
      const padRight = i < cells.length - 1 ? "18px" : "0";
      return (
        `<td width="${colWidth}%" valign="top" ` +
        `style="${leftBorder}padding:0 ${padRight} 0 ${padLeft}; mso-line-height-rule:exactly;">` +
          `<div style="font-size:11px; color:${C.fgTertiary}; letter-spacing:0.04em; text-transform:uppercase; font-weight:500; line-height:1.4; margin:0 0 4px 0;">${escapeHtml(c.label)}</div>` +
          `<div style="font-size:14px; color:${C.fgPrimary}; font-weight:500; letter-spacing:0.005em; line-height:1.4;">${escapeHtml(c.value)}</div>` +
        `</td>`
      );
    })
    .join("");

  return (
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:22px 0 36px 0; background:${C.bgVisit}; border:1px solid ${C.border}; border-radius:${C.radiusLg}; border-collapse:separate;">` +
      `<tr><td style="padding:16px 18px;">` +
        `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">` +
          `<tr>${innerCells}</tr>` +
        `</table>` +
      `</td></tr>` +
    `</table>`
  );
}

function renderRatingPrompt(prompt: string): string {
  return `<p style="font-size:16px; line-height:1.4; font-weight:500; color:${C.fgPrimary}; letter-spacing:0.005em; margin:0 0 22px 0;">${escapeHtml(prompt)}</p>`;
}

function renderStars(href: (n: number) => string, starUrl: string): string {
  // 5 cells spread across the FULL card width (each width="20%"), centered
  // inside its cell. Each cell renders a hosted SVG star (rounded points
  // via stroke-linejoin=round) instead of the Unicode ☆ U+2606 glyph the
  // template used to ship: Karam called the system glyph "too pointy", and
  // there is no Unicode codepoint for a rounded outline star, so we have
  // to ship a vector asset and reference it by URL.
  //
  // Compatibility:
  //   - Gmail web / Android, iOS Mail, Apple Mail, Outlook 365 web /
  //     mobile, Yahoo: <img src="*.svg"> renders fine.
  //   - Outlook Win32 (Word renderer): SVG via <img> NOT supported. The
  //     <!--[if mso]> branch below falls back to the Unicode glyph for
  //     that audience, so they still see a star (the pointy original).
  //
  // Sizing: card inner width on desktop = 640 - 96 padding = 544px. Star
  // image renders at 80x80, so 5 stars ≈ 400px across 544px inner with
  // ~28px breathing room per cell side.
  const cells = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td width="20%" align="center" valign="middle" style="padding:0; mso-line-height-rule:exactly;">` +
          `<a href="${escapeHtml(href(n))}" aria-label="${n} von 5 Sternen" ` +
          `style="display:inline-block; padding:4px; line-height:1; ` +
          `text-decoration:none; mso-line-height-rule:exactly;">` +
          // Outlook desktop fallback (Unicode glyph, since it strips SVG):
          `<!--[if mso]>` +
            `<span style="font-size:80px; line-height:1; color:#E8B73C; font-weight:300;">&#9734;</span>` +
          `<![endif]-->` +
          // Everyone else:
          `<!--[if !mso]><!-->` +
            `<img src="${escapeHtml(starUrl)}" width="80" height="80" ` +
            `alt="" style="display:block; width:80px; height:80px; border:0; outline:none; text-decoration:none;">` +
          `<!--<![endif]-->` +
          `</a>` +
        `</td>`
    )
    .join("");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 12px 0;"><tr>${cells}</tr></table>`;
}

function renderScaleLegend(): string {
  // Spans full card width so the labels align with the outer two stars.
  // Left-aligned "1 sehr unzufrieden" sits under the leftmost star; right-
  // aligned "5 sehr zufrieden" sits under the rightmost star.
  return (
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0;">` +
      `<tr>` +
        `<td width="50%" align="left" style="font-size:12.5px; color:${C.fgTertiary}; letter-spacing:0.012em; mso-line-height-rule:exactly;">` +
          `<span style="font-variant-numeric:tabular-nums; color:${C.fgSecondary}; font-weight:500;">1</span>&nbsp;&nbsp;sehr unzufrieden` +
        `</td>` +
        `<td width="50%" align="right" style="font-size:12.5px; color:${C.fgTertiary}; letter-spacing:0.012em; mso-line-height-rule:exactly;">` +
          `<span style="font-variant-numeric:tabular-nums; color:${C.fgSecondary}; font-weight:500;">5</span>&nbsp;&nbsp;sehr zufrieden` +
        `</td>` +
      `</tr>` +
    `</table>`
  );
}

function renderFollowup(): string {
  return `<p style="font-size:15.5px; line-height:1.6; color:${C.fgPrimary}; margin:36px 0 0 0; letter-spacing:0.005em;">Sie können auf der folgenden Seite zwischen einer öffentlichen Bewertung und einer privaten Rückmeldung an die Praxis wählen, ganz wie es Ihnen lieber ist.</p>`;
}

function renderDivider(): string {
  return `<div style="height:1px; line-height:1px; font-size:0; background:${C.border}; margin:36px 0 22px 0;">&nbsp;</div>`;
}

function renderFooter(reminderText: string, unsubUrl: string): string {
  // Single-line footnote inside the card. Question + unsub link inline.
  return (
    `<div style="font-size:12.5px; line-height:1.55; color:${C.fgTertiary}; letter-spacing:0.012em;">` +
      `${escapeHtml(reminderText)} Möchten Sie keine weiteren Erinnerungen erhalten? ` +
      `<a href="${escapeHtml(unsubUrl)}" style="color:${C.fgSecondary}; text-decoration:underline;">Hier abmelden</a>.` +
    `</div>`
  );
}

interface ShellInput {
  preheader: string;
  title: string;
  cardInnerHtml: string;
}

function renderShell({
  preheader,
  title,
  cardInnerHtml,
}: ShellInput): string {
  // The whole email document. Outer table = page bg. Inner 640px table = card
  // + sent-meta. The card padding is 44/48/40, smaller on mobile (handled
  // inline via percent widths inside the card so we don't need a <style>
  // block — those get stripped by Gmail/Outlook anyway).
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
<!--[if mso]>
<style>
  table, td, div, h1, p, a { font-family: Helvetica, Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0; padding:0; background:${C.bgPage}; color:${C.fgPrimary}; font-family:${C.fontStack}; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;">
<div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${C.bgPage};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="640" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:640px;">
<tr><td style="background:${C.bgCard}; border:1px solid ${C.border}; border-radius:${C.radius2xl}; padding:44px 48px 40px 48px; box-shadow:${SHADOW_CARD};">
${cardInnerHtml}
</td></tr>
<tr><td style="padding:18px 8px 0 8px; font-size:12px; color:${C.fgTertiary}; letter-spacing:0.012em; line-height:1.5;">
Versendet über EINS &middot; Antworten landen direkt in Ihrer Praxis-Inbox.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
