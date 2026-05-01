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
    });
  }
}

// ---------------------------------------------------------------------------
// Resend (production)
// ---------------------------------------------------------------------------
class ResendEmailSender implements EmailSender {
  // Lazy import so the dep tree stays clean when not used.
  async send(input: SendEmailInput): Promise<void> {
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);
    const res = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (res.error) {
      throw new Error(`Resend send failed: ${res.error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let cached: EmailSender | undefined;
export function getEmailSender(): EmailSender {
  if (cached) return cached;
  if (env.EMAIL_DRIVER === "resend" && hasResend()) {
    cached = new ResendEmailSender();
  } else if (env.EMAIL_DRIVER === "mailhog") {
    cached = new MailhogEmailSender();
  } else {
    cached = new ConsoleEmailSender();
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Templated helpers
// ---------------------------------------------------------------------------

function layoutHtml(innerHtml: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>EINS Visuals</title></head>
<body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color:#10101a; background:#f5f5f7; margin:0; padding:32px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4e4e7; border-radius:16px; padding:32px;">
    <div style="font-size:14px; letter-spacing:0.04em; color:#4a4a52; margin-bottom:24px;">EINS Visuals Portal</div>
    ${innerHtml}
    <hr style="border:none; border-top:1px solid #e4e4e7; margin:32px 0;">
    <div style="font-size:12px; color:#8a8a94;">
      Sie erhalten diese E-Mail, weil jemand einen Zugang zum EINS Visuals Portal angefordert hat.
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
      ? `Ihr Zugang zum EINS Visuals Portal${opts.clinicName ? ` für ${opts.clinicName}` : ""}`
      : "Ihr Anmelde-Link für das EINS Visuals Portal";
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

export async function sendUpgradeRequestEmail(opts: {
  to: string;
  clinicName: string;
  requestedBy: string;
  currentPlan: string;
  note?: string;
}): Promise<void> {
  const sender = getEmailSender();
  const subject = `Upgrade-Anfrage: ${opts.clinicName}`;
  const html = layoutHtml(`
    <h1 style="font-size:22px; font-weight:600; margin:0 0 16px 0;">${subject}</h1>
    <p style="font-size:16px; line-height:1.5;">
      <strong>${opts.requestedBy}</strong> möchte für <strong>${opts.clinicName}</strong> auf das Erweitert-Paket wechseln.
    </p>
    <p style="font-size:14px; color:#4a4a52;">Aktuelles Paket: ${opts.currentPlan}</p>
    ${opts.note ? `<blockquote style="border-left:3px solid #58BAB5; padding-left:16px; margin:16px 0; color:#10101a;">${opts.note}</blockquote>` : ""}`);
  const text = [
    subject,
    "",
    `${opts.requestedBy} möchte für ${opts.clinicName} auf das Erweitert-Paket wechseln.`,
    `Aktuelles Paket: ${opts.currentPlan}`,
    opts.note ? `\nNotiz: ${opts.note}` : "",
  ].join("\n");
  await sender.send({ to: opts.to, subject, html, text });
}
