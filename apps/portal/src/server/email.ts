import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import { env, emailLogoUrl, hasResend } from "../lib/env";

// ---------------------------------------------------------------------------
// Brand tokens — sourced 1:1 from the EINS Portal Design System "Minimal"
// email variant exported via Claude Design (see .claude/design-* bundle).
// Anything brand-related must come from here, not literal hex elsewhere.
// ---------------------------------------------------------------------------
const BRAND = {
  accent: "#58BAB5",
  accentBright: "#64CEC9",
  fgPrimary: "#10101a", // body + headlines + CTA fill
  fgSecondary: "#4a4a52", // intro paragraph + audit values
  fgTertiary: "#6a6a74", // meta row + reassurance + audit labels + footer
  bgPage: "#f5f5f7", // outer page bg + chip/grid surfaces
  bgCard: "#ffffff",
  border: "#e4e4e7",
  borderHover: "#d1d1d6", // separator dot in meta row
  radiusCard: "16px",
  radiusGrid: "12px",
  radiusBox: "8px",
  radiusPill: "999px",
  // SINGLE QUOTES around multi-word font names: this string is interpolated
  // into HTML `style="..."` attributes; double quotes would terminate the
  // attribute early and break the entire body's CSS in HTML parsers that
  // aren't generously lenient (notably Outlook). CSS accepts both quote
  // styles equally — single is the safe one inside a double-quoted attr.
  fontStack:
    "'Neue Haas Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const;

/**
 * Email sender — adapter pattern so the same code path supports local dev
 * (console), Docker (Mailhog SMTP), and production (Resend API).
 *
 * Dev default: EMAIL_DRIVER=console. We log the rendered message to stdout
 * so a human tester can click the magic-link straight from the terminal.
 *
 * To flip to Mailhog: EMAIL_DRIVER=mailhog, then open http://localhost:8025.
 * To flip to prod:    EMAIL_DRIVER=resend, plus RESEND_API_KEY.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * If set, drivers add `List-Unsubscribe: <{url}>, <mailto:{from}?subject=unsubscribe>`
   * and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058).
   * Gmail/Yahoo treat one-click unsubscribe as a strong reputation signal —
   * marketing-class mail without it lands in spam at scale.
   */
  unsubscribeUrl?: string | null;
}

export interface EmailSender {
  send(input: SendEmailInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Console (default dev)
// ---------------------------------------------------------------------------
class ConsoleEmailSender implements EmailSender {
  async send(input: SendEmailInput): Promise<void> {
    const banner = "─".repeat(72);
    console.log(`\n${banner}`);
    console.log(`  ✉  EMAIL (console driver)`);
    console.log(`     To:      ${input.to}`);
    console.log(`     Subject: ${input.subject}`);
    console.log(banner);
    console.log(input.text);
    const urlMatch = input.text.match(/https?:\/\/[^\s<>"]+/);
    if (urlMatch) {
      console.log(`\n  🔗 ${urlMatch[0]}\n`);
    }
    console.log(`${banner}\n`);
  }
}

// ---------------------------------------------------------------------------
// Mailhog (SMTP to localhost:1025, no auth)
// ---------------------------------------------------------------------------
class MailhogEmailSender implements EmailSender {
  private transporter: Transporter;
  constructor() {
    this.transporter = createTransport({
      host: "localhost",
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
  }
  async send(input: SendEmailInput): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: buildUnsubscribeHeaders(input.unsubscribeUrl),
      replyTo: env.EMAIL_REPLY_TO,
    });
  }
}

// ---------------------------------------------------------------------------
// Resend (production)
// ---------------------------------------------------------------------------
class ResendEmailSender implements EmailSender {
  // Lazy import so the dep tree stays clean when not used; client instance
  // is cached on first send so the HTTP-client setup doesn't run on every
  // call. (resend@latest constructs an internal fetch client on `new`.)
  private clientP: Promise<{
    emails: {
      send: (args: {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
        replyTo?: string;
        headers?: Record<string, string>;
      }) => Promise<{ error?: { message: string } | null }>;
    };
  }> | null = null;

  private getClient() {
    if (!this.clientP) {
      this.clientP = import("resend").then(
        ({ Resend }) =>
          new Resend(env.RESEND_API_KEY) as unknown as {
            emails: {
              send: (args: {
                from: string;
                to: string[];
                subject: string;
                html: string;
                text: string;
                replyTo?: string;
                headers?: Record<string, string>;
              }) => Promise<{ error?: { message: string } | null }>;
            };
          }
      );
    }
    return this.clientP;
  }

  async send(input: SendEmailInput): Promise<void> {
    const resend = await this.getClient();
    const res = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: env.EMAIL_REPLY_TO,
      headers: buildUnsubscribeHeaders(input.unsubscribeUrl),
    });
    if (res.error) {
      throw new Error(`Resend send failed: ${res.error.message}`);
    }
  }
}

/**
 * Build the RFC 8058 List-Unsubscribe headers, or an empty object when the
 * caller didn't supply an unsubscribe URL (most transactional sends won't —
 * a magic-link email has no marketing relationship to unsubscribe from).
 */
function buildUnsubscribeHeaders(
  unsubscribeUrl: string | null | undefined
): Record<string, string> | undefined {
  if (!unsubscribeUrl) return undefined;
  // The mailto fallback uses the From header so MUAs that only support the
  // mailto form (older clients) still get a working button.
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${env.EMAIL_FROM}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Wrap plaintext into a branded HTML body. Used by `processEmailSend` when
 * callers enqueue a text-only payload (the worker can't know what the body
 * "is", so it just needs a safe, on-brand shell). The text is split on blank
 * lines into paragraphs so it doesn't render as one indistinguishable block.
 */
export function buildBrandedEmailHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:${BRAND.fgPrimary};">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
  return renderEmailLayout({
    preheader: text.replace(/\s+/g, " ").slice(0, 140),
    heading: "EINS Portal",
    bodyHtml: paragraphs || `<p style="margin:0;">&nbsp;</p>`,
  });
}

// ---------------------------------------------------------------------------
// Tee — fan a send out to multiple senders so dev always sees a console
// banner even when the primary driver is Mailhog or Resend.
// ---------------------------------------------------------------------------
class TeeEmailSender implements EmailSender {
  constructor(private readonly senders: EmailSender[]) {}
  async send(input: SendEmailInput): Promise<void> {
    // Always try every sender; if one fails we want the others (e.g. the
    // console banner with the magic link) to still surface. The first error
    // is rethrown so the caller still sees a failure.
    let firstError: unknown = null;
    await Promise.all(
      this.senders.map(async (s) => {
        try {
          await s.send(input);
        } catch (err) {
          if (firstError === null) firstError = err;
        }
      })
    );
    if (firstError) throw firstError;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let cached: EmailSender | undefined;
export function getEmailSender(): EmailSender {
  if (cached) return cached;

  // Pick the primary driver. If EMAIL_DRIVER=resend was configured without
  // RESEND_API_KEY, fall back to the console driver — but say so loudly
  // (the silent fallback was an onboarding trap: the docs told developers
  // to look for a terminal banner, and nothing fired the console driver
  // because the producer of the email crashed first or used a different
  // driver). We log here, exactly once per process, when the factory runs.
  let primary: EmailSender;
  if (env.EMAIL_DRIVER === "resend") {
    if (hasResend()) {
      primary = new ResendEmailSender();
    } else {
      console.warn(
        "[email] EMAIL_DRIVER=resend but RESEND_API_KEY is not set — " +
          "falling back to the console driver. Magic-link URLs will be " +
          "printed in this terminal."
      );
      primary = new ConsoleEmailSender();
    }
  } else if (env.EMAIL_DRIVER === "mailhog") {
    primary = new MailhogEmailSender();
  } else {
    primary = new ConsoleEmailSender();
  }

  // In dev, always also log to the console, regardless of the primary
  // driver. This makes the "click the magic link from your terminal" flow
  // work even when Mailhog is up — clicking through to Mailhog's web UI is
  // an extra hop a new dev shouldn't need.
  if (
    env.NODE_ENV !== "production" &&
    !(primary instanceof ConsoleEmailSender)
  ) {
    cached = new TeeEmailSender([primary, new ConsoleEmailSender()]);
  } else {
    cached = primary;
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Layout — single source of truth for every transactional HTML email.
//
// Recreates the EINS Portal Design System "Minimal" email variant exported
// via Claude Design (full spec: .claude/design-email-variants.jsx):
//   - 640px frame on a soft-gray (#f5f5f7) page
//   - EINS PNG wordmark ABOVE the white card
//   - White card with 16px-radius border + soft shadow
//   - 30px H1, secondary-color intro paragraph
//   - DARK pill CTA (#10101a fill, white text, full pill radius)
//   - Inline meta row with clock / shield icons and a dot separator
//   - 2-cell audit grid (e.g. ANGEFORDERT | KONTO) with uppercase labels
//   - Divider, then boxed fallback link, then reassurance line
//   - Footer OUTSIDE the card: [Firmenname] · [Straße Nr.] · [PLZ Ort]
//     + the auto-send disclaimer
//
// Email-client constraints honored:
//   - inline styles only (Gmail/Outlook strip <style>)
//   - PNG logo (SVG would be stripped by Gmail / Outlook desktop)
//   - VML roundrect for the CTA so Outlook Word ships a pill, not a link
//   - Table scaffolding throughout so Outlook desktop holds layout
//   - Inline SVG icons in the meta row are decorative; text alone reads
//     fine in clients that strip SVG
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailMetaIcon = "clock" | "shield";
export interface EmailMetaItem {
  icon: EmailMetaIcon;
  text: string;
}
export interface EmailAuditRow {
  label: string;
  value: string;
}

export interface EmailLayoutInput {
  /** Hidden inbox preview text (Gmail / Apple Mail show it next to subject). */
  preheader: string;
  /** H1 heading. Will be escaped. */
  heading: string;
  /** Pre-escaped paragraph(s) for the intro section under the H1. */
  introHtml?: string;
  /** Primary CTA, rendered as a dark pill button. */
  cta?: { label: string; url: string };
  /** Inline icon-meta row right under the CTA (e.g. clock + "15 Minuten gültig"). */
  metaItems?: EmailMetaItem[];
  /** 1- or 2-cell audit grid below the meta row. */
  auditRows?: EmailAuditRow[];
  /** Pre-escaped raw block injected after intro / before CTA. For star ratings, quotes, etc. */
  customBlockHtml?: string;
  /** Renders the "Falls der Button nicht funktioniert..." block under a divider. */
  fallbackUrl?: string;
  /** Pre-escaped reassurance paragraph at the end of the card. */
  reassuranceHtml?: string;
  /** Escape hatch to override the entire card body. Used by the plaintext-wrapper shim. */
  bodyHtml?: string;
  /**
   * Override the default 2-line footer. First line replaces the legal
   * placeholder, second the disclaimer. Pass an empty string in a slot to
   * suppress that line. Values are HTML-escaped — use `footerExtraHtml` for
   * markup like unsubscribe links.
   */
  footerLines?: [string, string];
  /**
   * Pre-escaped HTML rendered below `footerLines` (e.g. unsubscribe link
   * for patient mail, recovery hint for admins). Optional.
   */
  footerExtraHtml?: string;
}

const META_ICONS: Record<EmailMetaIcon, string> = {
  // Decorative SVGs. Apple Mail / iOS Mail / Outlook.com render them; Gmail
  // and Outlook desktop strip them, leaving just the adjacent text — which
  // still reads fine ("Link 15 Minuten gültig"). aria-hidden so screen
  // readers don't announce them.
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block; vertical-align:-2px; margin-right:6px;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  shield: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block; vertical-align:-2px; margin-right:6px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
};

function bulletproofCta(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  // VML width sized loosely from the label so Outlook doesn't clip long
  // CTAs. ~9px per char + 56px combined padding, floored at 180px.
  const msoWidth = Math.max(180, Math.ceil(label.length * 9 + 56));
  // arcsize="50%" on a 48px-tall roundrect gives Outlook a full pill.
  return (
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">` +
    `<tr><td align="left">` +
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:${msoWidth}px;" arcsize="50%" stroke="f" fillcolor="${BRAND.fgPrimary}">` +
    `<w:anchorlock/>` +
    `<center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.012em;">${safeLabel}</center>` +
    `</v:roundrect>` +
    `<![endif]-->` +
    `<!--[if !mso]><!-- -->` +
    `<a href="${safeUrl}" style="display:inline-block; background:${BRAND.fgPrimary}; color:#ffffff; font-weight:600; padding:15px 28px; border-radius:${BRAND.radiusPill}; text-decoration:none; font-size:15px; line-height:1.2; letter-spacing:0.012em; box-shadow:0 1px 2px rgba(16,16,26,0.18); mso-hide:all;">${safeLabel}</a>` +
    `<!--<![endif]-->` +
    `</td></tr></table>`
  );
}

function renderMetaRow(items: EmailMetaItem[]): string {
  // Single-row table with one cell per meta item + dot-separator cells
  // between items. Tables (not flex) so Outlook desktop holds the line.
  const cells = items
    .map((item, i) => {
      const icon = META_ICONS[item.icon] ?? "";
      const cell = `<td style="font-size:13px; line-height:1; color:${BRAND.fgTertiary}; letter-spacing:0.012em; padding:0; white-space:nowrap; mso-line-height-rule:exactly;">${icon}${escapeHtml(item.text)}</td>`;
      if (i === items.length - 1) return cell;
      const sep = `<td style="padding:0 12px; mso-line-height-rule:exactly;"><span style="display:inline-block; width:3px; height:3px; border-radius:999px; background:${BRAND.borderHover}; vertical-align:middle; line-height:3px; font-size:0;">&nbsp;</span></td>`;
      return cell + sep;
    })
    .join("");
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 32px 0;"><tr>${cells}</tr></table>`;
}

function renderAuditGrid(rows: EmailAuditRow[]): string {
  // 2-column table. With 1 row it spans full width. border-collapse:separate
  // preserves the 12px outer radius in Apple Mail / iOS / Gmail; Outlook
  // ignores radius but keeps the border definition.
  const colWidth = rows.length === 1 ? "100%" : "50%";
  const cells = rows
    .map((row, i) => {
      const borderRight =
        rows.length > 1 && i === 0
          ? `border-right:1px solid ${BRAND.border};`
          : "";
      return (
        `<td width="${colWidth}" style="padding:14px 16px; background:${BRAND.bgPage}; ${borderRight} vertical-align:top;">` +
        `<div style="font-size:11px; color:${BRAND.fgTertiary}; letter-spacing:0.04em; text-transform:uppercase; margin:0 0 4px 0; font-weight:500;">${escapeHtml(row.label)}</div>` +
        `<div style="font-size:13px; color:${BRAND.fgPrimary}; font-variant-numeric:tabular-nums; letter-spacing:0.012em; word-break:break-all; line-height:1.4;">${escapeHtml(row.value)}</div>` +
        `</td>`
      );
    })
    .join("");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 32px 0; border:1px solid ${BRAND.border}; border-radius:${BRAND.radiusGrid}; border-collapse:separate; overflow:hidden;"><tr>${cells}</tr></table>`;
}

function renderFallbackBlock(url: string): string {
  const safeUrl = escapeHtml(url);
  return (
    `<div style="height:1px; line-height:1px; font-size:0; background:${BRAND.border}; margin:32px 0 24px 0;">&nbsp;</div>` +
    `<div style="font-size:13px; color:${BRAND.fgTertiary}; margin:0 0 8px 0; letter-spacing:0.012em; line-height:1.5;">Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:</div>` +
    `<div style="font-size:12px; color:${BRAND.fgSecondary}; word-break:break-all; background:${BRAND.bgPage}; border:1px solid ${BRAND.border}; border-radius:${BRAND.radiusBox}; padding:10px 12px; font-variant-numeric:tabular-nums; line-height:1.5;">` +
    `<a href="${safeUrl}" style="color:${BRAND.fgSecondary}; text-decoration:none;">${safeUrl}</a>` +
    `</div>`
  );
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const logoUrl = emailLogoUrl();
  const homeUrl = env.APP_ORIGIN;

  const headingHtml = `<h1 style="font-size:30px; font-weight:600; line-height:1.15; margin:0 0 16px 0; letter-spacing:0; color:${BRAND.fgPrimary};">${escapeHtml(input.heading)}</h1>`;

  const body =
    input.bodyHtml !== undefined
      ? input.bodyHtml
      : [
          input.introHtml ?? "",
          input.customBlockHtml ?? "",
          input.cta ? bulletproofCta(input.cta.label, input.cta.url) : "",
          input.metaItems && input.metaItems.length
            ? renderMetaRow(input.metaItems)
            : "",
          input.auditRows && input.auditRows.length
            ? renderAuditGrid(input.auditRows)
            : "",
          input.fallbackUrl ? renderFallbackBlock(input.fallbackUrl) : "",
          input.reassuranceHtml
            ? `<div style="margin:${input.fallbackUrl ? "28px" : "32px"} 0 0 0;">${input.reassuranceHtml}</div>`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

  const footerLine1 =
    input.footerLines?.[0] ?? "EINS · Rösrather Straße 172 · 51107 Köln";
  const footerLine2 =
    input.footerLines?.[1] ??
    "Diese E-Mail wurde automatisch versendet. Bitte antworten Sie nicht direkt.";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(input.heading)}</title>
<!--[if mso]>
<style>
  table, td, div, h1, p, a { font-family: Helvetica, Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0; padding:0; background:${BRAND.bgPage}; color:${BRAND.fgPrimary}; font-family:${BRAND.fontStack}; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;">
<div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${BRAND.bgPage};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="640" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:640px;">
<tr><td style="padding:0 8px 20px 8px;">
<a href="${homeUrl}" style="display:inline-block; text-decoration:none; border:0; outline:none;"><img src="${logoUrl}" alt="EINS" width="70" height="28" style="display:block; height:28px; width:70px; border:0; outline:none; text-decoration:none;"></a>
</td></tr>
<tr><td style="background:${BRAND.bgCard}; border:1px solid ${BRAND.border}; border-radius:${BRAND.radiusCard}; padding:40px 40px 36px 40px; box-shadow:0 1px 2px rgba(16,16,26,0.04), 0 12px 32px -16px rgba(16,16,26,0.10);">
${headingHtml}
${body}
</td></tr>
<tr><td style="text-align:center; font-size:12px; color:${BRAND.fgTertiary}; padding:24px 8px 0 8px; line-height:1.6; letter-spacing:0.012em;">
${footerLine1 ? escapeHtml(footerLine1) : ""}${footerLine1 && footerLine2 ? "<br>" : ""}${footerLine2 ? escapeHtml(footerLine2) : ""}${input.footerExtraHtml ? `<div style="margin-top:10px; color:${BRAND.fgTertiary};">${input.footerExtraHtml}</div>` : ""}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function formatRequestedAt(d: Date = new Date()): string {
  // dd.MM.yyyy, HH:mm in Europe/Berlin (DACH audience).
  const fmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Intl returns "27.05.2026, 21:19" but with a thin NBSP some clients render
  // oddly. Normalize whitespace.
  return fmt.format(d).replace(/ /g, " ");
}

// ---------------------------------------------------------------------------
// Templated helpers
// ---------------------------------------------------------------------------

export async function sendMagicLinkEmail(opts: {
  to: string;
  url: string;
  intent: "login" | "invite" | "set_password" | "reset_password";
  clinicName?: string;
  /**
   * Recipient's full name (e.g. "Dr. Jan Berger") as stored on
   * `clinic_users.full_name`. When present the intro is prefixed with
   * "Guten Tag, {name}." — see the reset-password reference design.
   * Doctor titles pass through verbatim; we don't try to last-name-only-ify
   * because German salutations work equally well with the full name and the
   * parsing would be fragile. Pass null/undefined to render a neutral intro.
   */
  recipientName?: string | null;
  /**
   * When the user actually triggered the request (clicked "reset password",
   * submitted the login form, etc.). Defaults to render time. Callers SHOULD
   * pass the action-entry timestamp so the "Angefordert" cell stays truthful
   * if the send is queued or delayed.
   */
  requestedAt?: Date;
}): Promise<void> {
  const sender = getEmailSender();
  const requestedAt = opts.requestedAt ?? new Date();
  const trimmedName = opts.recipientName?.trim();
  // Skip the salutation for invite — the recipient is a brand-new account
  // that hasn't given us a name yet; "Guten Tag, " with no name reads broken.
  // For login/set/reset, we have a real user row so the name is the norm.
  const salutation =
    trimmedName && opts.intent !== "invite"
      ? `Guten Tag, ${trimmedName}. `
      : "";

  const copy = (() => {
    switch (opts.intent) {
      case "invite":
        return {
          subject: opts.clinicName
            ? `EINS · Ihr Zugang für ${opts.clinicName}`
            : "EINS · Ihr Zugang zum Portal",
          heading: opts.clinicName
            ? `Willkommen im EINS Portal für ${opts.clinicName}`
            : "Willkommen im EINS Portal",
          intro:
            "Klicken Sie auf den Button, um Ihren Zugang einzurichten und ein Passwort festzulegen.",
          ctaLabel: "Zugang einrichten",
          reassurance:
            "Sie kennen diese Einladung nicht? Ignorieren Sie diese E-Mail einfach. Es passiert nichts weiter.",
        };
      case "set_password":
        return {
          subject: "EINS · Passwort einrichten",
          heading: "Richten Sie Ihr Passwort ein",
          intro:
            "Ab jetzt loggen Sie sich mit E-Mail und Passwort ein. Klicken Sie auf den Button, um ein Passwort festzulegen.",
          ctaLabel: "Passwort festlegen",
          reassurance:
            "Sie haben kein Passwort angefordert? Ignorieren Sie diese E-Mail. Ihr Konto bleibt unverändert.",
        };
      case "reset_password":
        return {
          subject: "EINS · Neues Passwort",
          heading: "Setzen Sie ein neues Passwort",
          intro:
            "Klicken Sie auf den Button, um ein neues Passwort für Ihr EINS-Konto zu vergeben.",
          ctaLabel: "Neues Passwort wählen",
          reassurance:
            "Sie haben kein neues Passwort angefordert? Ignorieren Sie diese E-Mail. Ihr aktuelles Passwort bleibt unverändert.",
        };
      case "login":
      default:
        return {
          subject: "EINS · Anmelde-Link",
          heading: "Melden Sie sich beim EINS Portal an",
          intro:
            "Klicken Sie auf den Button, um sich ohne Passwort anzumelden.",
          ctaLabel: "Jetzt anmelden",
          reassurance:
            "Sie haben sich nicht beim EINS Portal angemeldet? Ignorieren Sie diese E-Mail. Es passiert nichts weiter.",
        };
    }
  })();

  const introText = `${salutation}${copy.intro}`;
  const html = renderEmailLayout({
    preheader: `${introText} Der Link ist 15 Minuten gültig.`,
    heading: copy.heading,
    introHtml: `<p style="font-size:16px; line-height:1.55; color:${BRAND.fgSecondary}; margin:0 0 28px 0; letter-spacing:0.012em;">${escapeHtml(introText)}</p>`,
    cta: { label: copy.ctaLabel, url: opts.url },
    metaItems: [
      { icon: "clock", text: "Link 15 Minuten gültig" },
      { icon: "shield", text: "Nur einmal verwendbar" },
    ],
    auditRows: [
      { label: "Angefordert", value: formatRequestedAt(requestedAt) },
      { label: "Konto", value: opts.to },
    ],
    fallbackUrl: opts.url,
    reassuranceHtml: `<p style="font-size:13px; line-height:1.55; color:${BRAND.fgTertiary}; margin:0; letter-spacing:0.012em;">${escapeHtml(copy.reassurance)}</p>`,
  });

  const text = [
    copy.heading,
    "",
    introText,
    "",
    `Link:         15 Minuten gültig, nur einmal verwendbar`,
    `Angefordert:  ${formatRequestedAt(requestedAt)}`,
    `Konto:        ${opts.to}`,
    "",
    opts.url,
    "",
    copy.reassurance,
  ].join("\n");

  await sender.send({ to: opts.to, subject: copy.subject, html, text });
}

export async function sendFeedbackEmail(opts: {
  to: string;
  clinicName: string;
  submittedBy: string;
  categoryLabel: string;
  message: string;
  pageUrl?: string;
}): Promise<void> {
  const sender = getEmailSender();
  const subject = `EINS · Feedback aus ${opts.clinicName}`;
  const escapedMessage = escapeHtml(opts.message).replace(/\n/g, "<br>");

  const quoteBlock = `<blockquote style="margin:0 0 32px 0; padding:18px 20px; background:${BRAND.bgPage}; border-left:3px solid ${BRAND.accent}; border-radius:0 ${BRAND.radiusBox} ${BRAND.radiusBox} 0; color:${BRAND.fgPrimary}; font-size:15px; line-height:1.55; letter-spacing:0.012em;">${escapedMessage}</blockquote>`;

  const auditRows = [
    { label: "Praxis", value: opts.clinicName },
    { label: "Von", value: opts.submittedBy },
  ];
  // Second row holds category + page (if present).
  const auditRows2 = opts.pageUrl
    ? [
        { label: "Kategorie", value: opts.categoryLabel },
        { label: "Seite", value: opts.pageUrl },
      ]
    : [{ label: "Kategorie", value: opts.categoryLabel }];

  const html = renderEmailLayout({
    preheader: `${opts.categoryLabel} von ${opts.submittedBy} (${opts.clinicName})`,
    heading: `Feedback aus ${opts.clinicName}`,
    introHtml: `<p style="font-size:16px; line-height:1.55; color:${BRAND.fgSecondary}; margin:0 0 28px 0; letter-spacing:0.012em;">Neue Rückmeldung aus dem Portal.</p>`,
    customBlockHtml: quoteBlock + renderAuditGrid(auditRows) + renderAuditGrid(auditRows2),
    footerLines: [
      "Interne Benachrichtigung · EINS Portal",
      "Diese E-Mail wurde automatisch versendet. Bitte antworten Sie nicht direkt.",
    ],
  });

  const text = [
    subject,
    "",
    `Praxis:    ${opts.clinicName}`,
    `Von:       ${opts.submittedBy}`,
    `Kategorie: ${opts.categoryLabel}`,
    opts.pageUrl ? `Seite:     ${opts.pageUrl}` : "",
    "",
    opts.message,
  ]
    .filter(Boolean)
    .join("\n");
  await sender.send({ to: opts.to, subject, html, text });
}
