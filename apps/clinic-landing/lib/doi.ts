import crypto from "node:crypto";
import { Resend } from "resend";
import type { Clinic } from "./types";

/**
 * Double-opt-in for the marketing consent.
 *
 * Why stateless: this app has no DB. Each token is a self-contained, HMAC-signed
 * blob (email | clinicSlug | treatmentSlug | eventId | exp). The confirmation
 * route re-derives the signature from `DOI_SIGNING_SECRET`, checks expiry, and
 * fires a `marketing-confirmed` follow-up event to the same CRM webhook. The
 * CRM upserts on email and flips the marketing flag from pending → confirmed.
 *
 * Token TTL is 48h (industry standard for German DOI). After expiry the patient
 * sees /lead/expired and can re-submit if they still want marketing.
 *
 * Replay protection: an in-memory Set keeps confirmed token-IDs for the same
 * dedup window the lead route uses. A second click is a no-op (idempotent for
 * the patient, no double event for the CRM).
 */

const TOKEN_TTL_SECONDS = 60 * 60 * 48; // 48h

export interface DoiClaims {
  /** Patient email, lowercased. */
  e: string;
  /** Clinic slug. */
  c: string;
  /** Treatment slug. */
  t: string;
  /** Original Meta event id from the initial submission. */
  id: string;
  /** Expiry — unix seconds. */
  x: number;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function requireSecret(): string {
  const s = process.env.DOI_SIGNING_SECRET;
  if (!s || s.length < 32) {
    throw new Error("DOI_SIGNING_SECRET is not set (need ≥32 random chars)");
  }
  return s;
}

export function signDoiToken(claims: Omit<DoiClaims, "x">): string {
  const full: DoiClaims = {
    ...claims,
    e: claims.e.toLowerCase().trim(),
    x: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(full));
  const sig = b64url(crypto.createHmac("sha256", requireSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; claims: DoiClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyDoiToken(token: string): VerifyResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [body, sig] = token.split(".", 2);
  if (!body || !sig) return { ok: false, reason: "malformed" };

  const expected = crypto.createHmac("sha256", requireSecret()).update(body).digest();
  let given: Buffer;
  try {
    given = b64urlDecode(sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  let claims: DoiClaims;
  try {
    claims = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, reason: "malformed" };
  if (!claims.e || !claims.c || !claims.t || !claims.id || typeof claims.x !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (claims.x < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

/**
 * In-memory replay guard for confirmed tokens. Re-uses the same 6h dedup
 * window as the lead route. Lives at module scope so it survives across
 * requests within a single serverless instance (best-effort — across instances
 * the CRM remains the source of truth via `eventId`).
 */
const CONFIRMED = new Map<string, number>();
const CONFIRMED_WINDOW_MS = 1000 * 60 * 60 * 6;

export function markConfirmedOnce(eventId: string): boolean {
  const now = Date.now();
  for (const [k, ts] of CONFIRMED.entries()) {
    if (now - ts > CONFIRMED_WINDOW_MS) CONFIRMED.delete(k);
  }
  if (CONFIRMED.has(eventId)) return false;
  CONFIRMED.set(eventId, now);
  return true;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Email sending — Resend
 * ────────────────────────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendDoiEmailArgs {
  to: string;
  firstName?: string;
  clinic: Clinic;
  confirmUrl: string;
}

export async function sendDoiEmail(args: SendDoiEmailArgs): Promise<{ ok: boolean; message?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DOI_FROM_EMAIL;
  if (!apiKey) return { ok: false, message: "RESEND_API_KEY missing" };
  if (!from) return { ok: false, message: "DOI_FROM_EMAIL missing" };

  const greeting = args.firstName ? `Hallo ${args.firstName},` : "Hallo,";
  const clinicName = args.clinic.name;
  const subject = `Bitte bestätigen Sie Ihre E-Mail-Adresse – ${clinicName}`;
  const text = [
    greeting,
    "",
    `vielen Dank für Ihr Interesse an ${clinicName}.`,
    "",
    "Sie haben angegeben, dass Sie gelegentlich Informationen zu Behandlungen und Terminen per E-Mail erhalten möchten. Bitte bestätigen Sie diese Einwilligung über den folgenden Link:",
    "",
    args.confirmUrl,
    "",
    "Der Link ist 48 Stunden gültig. Wenn Sie sich nicht bei uns gemeldet haben, ignorieren Sie diese E-Mail einfach – es wird Ihnen dann nichts zugeschickt.",
    "",
    "Ihre Anfrage zur Beratung wurde unabhängig davon bereits bei uns gespeichert; das Praxisteam meldet sich in Kürze.",
    "",
    `Mit freundlichen Grüßen,\n${clinicName}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="de">
<body style="margin:0;padding:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e5e5e7;">
          <tr><td style="padding:28px 28px 8px 28px;">
            <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">
              vielen Dank für Ihr Interesse an <strong>${escapeHtml(clinicName)}</strong>.
            </p>
            <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;">
              Sie haben angegeben, dass Sie gelegentlich Informationen zu Behandlungen und Terminen
              per E-Mail erhalten möchten. Bitte bestätigen Sie diese Einwilligung:
            </p>
          </td></tr>
          <tr><td align="center" style="padding:8px 28px 28px 28px;">
            <a href="${escapeHtml(args.confirmUrl)}"
               style="display:inline-block;background:#111;color:#fff;text-decoration:none;
                      padding:14px 22px;border-radius:8px;font-size:15px;font-weight:600;">
              E-Mail-Adresse bestätigen
            </a>
          </td></tr>
          <tr><td style="padding:0 28px 24px 28px;">
            <p style="margin:0 0 12px 0;font-size:13px;line-height:1.55;color:#555;">
              Der Link ist 48 Stunden gültig. Wenn Sie sich nicht bei uns gemeldet haben, ignorieren
              Sie diese E-Mail einfach — es wird Ihnen dann nichts zugeschickt.
            </p>
            <p style="margin:0;font-size:13px;line-height:1.55;color:#555;">
              Ihre Anfrage zur Beratung wurde unabhängig davon bereits bei uns gespeichert; das
              Praxisteam meldet sich in Kürze.
            </p>
          </td></tr>
          <tr><td style="padding:0 28px 28px 28px;border-top:1px solid #f0f0f2;">
            <p style="margin:18px 0 0 0;font-size:12px;line-height:1.5;color:#888;word-break:break-all;">
              Funktioniert der Button nicht? Kopieren Sie diesen Link in Ihren Browser:<br/>
              <span style="color:#555;">${escapeHtml(args.confirmUrl)}</span>
            </p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#999;">
          ${escapeHtml(clinicName)} · ${escapeHtml(args.clinic.address.street)},
          ${escapeHtml(args.clinic.address.zip)} ${escapeHtml(args.clinic.address.city)}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const resend = new Resend(apiKey);
    const fromHeader = /[<>]/.test(from) ? from : `${clinicName} <${from}>`;
    const result = await resend.emails.send({
      from: fromHeader,
      to: args.to,
      subject,
      html,
      text,
    });
    if (result.error) {
      return { ok: false, message: result.error.message ?? "resend error" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
