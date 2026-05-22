import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import { env, hasResend } from "../lib/env";

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
 * Wrap plaintext into a branded HTML body. Used by email-send when callers
 * enqueue a text-only payload. Spam filters score `<pre>` heavily — this
 * gives us a basic shell with brand color so transactional emails don't
 * trip Bayesian filters.
 */
export function buildBrandedEmailHtml(text: string): string {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<!doctype html><html lang="de"><body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color:#10101a; background:#f5f5f7; margin:0; padding:24px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4e4e7; border-radius:12px; padding:24px; font-size:15px; line-height:1.55;">
    <div style="font-size:12px; letter-spacing:0.04em; color:#4a4a52; margin-bottom:16px;">EINS Portal</div>
    ${safe}
  </div>
</body></html>`;
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
// Templated helpers
// ---------------------------------------------------------------------------

function layoutHtml(innerHtml: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>EINS</title></head>
<body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color:#10101a; background:#f5f5f7; margin:0; padding:32px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4e4e7; border-radius:16px; padding:32px;">
    <div style="font-size:14px; letter-spacing:0.04em; color:#4a4a52; margin-bottom:24px;">EINS Portal</div>
    ${innerHtml}
    <hr style="border:none; border-top:1px solid #e4e4e7; margin:32px 0;">
    <div style="font-size:12px; color:#8a8a94;">
      Sie erhalten diese E-Mail, weil jemand einen Zugang zum EINS Portal angefordert hat.
      Wurden Sie das nicht, ignorieren Sie bitte diese Nachricht.
    </div>
  </div>
</body></html>`;
}

export async function sendMagicLinkEmail(opts: {
  to: string;
  url: string;
  intent: "login" | "invite";
  clinicName?: string;
}): Promise<void> {
  const sender = getEmailSender();
  const heading =
    opts.intent === "invite"
      ? `Ihr Zugang zum EINS Portal${opts.clinicName ? ` für ${opts.clinicName}` : ""}`
      : "Ihr Anmelde-Link für das EINS Portal";
  const intro =
    opts.intent === "invite"
      ? "Klicken Sie auf den folgenden Link, um Ihren Zugang einzurichten. Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden."
      : "Klicken Sie auf den folgenden Link, um sich anzumelden. Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.";
  const html = layoutHtml(`
    <h1 style="font-size:24px; font-weight:600; color:#10101a; margin:0 0 16px 0;">${heading}</h1>
    <p style="font-size:16px; line-height:1.5; color:#10101a;">${intro}</p>
    <p style="margin:32px 0;">
      <a href="${opts.url}"
         style="display:inline-block; background:#58BAB5; color:#10101a; font-weight:600;
                padding:14px 24px; border-radius:12px; text-decoration:none; font-size:16px;">
        Jetzt anmelden
      </a>
    </p>
    <p style="font-size:13px; color:#4a4a52; word-break:break-all;">
      Oder kopieren Sie diesen Link in Ihren Browser:<br>
      <span style="color:#10101a;">${opts.url}</span>
    </p>`);
  const text = [heading, "", intro, "", opts.url, "", "Der Link ist 15 Minuten gültig."].join("\n");
  await sender.send({ to: opts.to, subject: heading, html, text });
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
  const subject = `Feedback (${opts.categoryLabel}): ${opts.clinicName}`;
  const escapedMessage = opts.message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const html = layoutHtml(`
    <h1 style="font-size:22px; font-weight:600; margin:0 0 16px 0;">${subject}</h1>
    <p style="font-size:14px; color:#4a4a52; margin:0 0 16px 0;">
      Von <strong>${opts.submittedBy}</strong> · Praxis <strong>${opts.clinicName}</strong>
      ${opts.pageUrl ? ` · Seite <code>${opts.pageUrl}</code>` : ""}
    </p>
    <blockquote style="border-left:3px solid #58BAB5; padding-left:16px; margin:16px 0; color:#10101a; font-size:15px; line-height:1.5;">
      ${escapedMessage}
    </blockquote>`);
  const text = [
    subject,
    "",
    `Von: ${opts.submittedBy}`,
    `Praxis: ${opts.clinicName}`,
    opts.pageUrl ? `Seite: ${opts.pageUrl}` : "",
    "",
    opts.message,
  ]
    .filter(Boolean)
    .join("\n");
  await sender.send({ to: opts.to, subject, html, text });
}

