"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminSession } from "@/auth/admin";
import { issueAdminMagicLink } from "@/auth/admin-magic-link";
import {
  issueAdminPasswordResetLink,
  verifyAdminPassword,
} from "@/auth/admin-password";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

/**
 * Admin login: Email + Passwort als primärer Pfad.
 *
 * Fallback-Pfade unter dem Formular: "Lieber per Email-Link anmelden"
 * (Magic-Link) und "Passwort vergessen" (Reset-Link).
 *
 * Enumeration-Resistenz: Wir geben dieselbe generische Fehlermeldung für
 * "User nicht in Allowlist", "Passwort falsch", "kein Passwort gesetzt"
 * zurück. Bestands-Admins ohne Passwort gehen explizit über "Passwort
 * vergessen" — dieser Pfad ist silent-no-op für non-allowlisted Mails und
 * leakt deshalb die ADMIN_EMAILS-Liste nicht.
 *
 * Action-Pattern (2026-05-28): Die Mail-Versand-Actions (Magic-Link und
 * Passwort-Reset) sowie alle Login-Error-Pfade geben State zurück statt zu
 * redirecten. Die Forms rendern Bestätigung/Fehler inline. Nur Login-Success
 * macht einen echten Server-Redirect auf /admin.
 *
 * Hintergrund: Next.js #65893 — bei aktiver Host-Rewrite-Middleware
 * (admin.* → /admin/*) zeigt ein redirect("/admin/...") aus einer
 * Server-Action die not-found.tsx bis zum nächsten Hard-Reload. Inline-State
 * umgeht den Bug komplett und ist gleichzeitig bessere UX (kein zusätzlicher
 * Seitenwechsel auf eine separate "Posteingang prüfen"-Route).
 */

const PasswordSchema = z.object({
  email: z.string().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  password: z.string().min(1, "Bitte geben Sie Ihr Passwort ein."),
});

const EmailOnlySchema = z.object({
  email: z.string().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
});

/** State-Shape für Mail-Versand-Actions (Magic-Link, Passwort-Reset). */
export type AdminMailActionState =
  | { ok: false; error: string }
  | { ok: true }
  | undefined;

/**
 * State-Shape für die Passwort-Login-Action. Bei Success setzen wir
 * `ok: true`; die LoginForm triggert dann clientseitig router.push("/admin").
 * Server-side redirect() bleibt absichtlich draussen — der Next.js #65893-Bug
 * würde sonst auch hier zuschlagen (bei einigen Tree-Übergängen, nicht alle).
 */
export type AdminLoginActionState =
  | { ok: false; error: string }
  | { ok: true; redirectTo: string }
  | undefined;

const ERR_INVALID_EMAIL = "Bitte geben Sie eine gültige E-Mail-Adresse ein.";
const ERR_INVALID_INPUT = "Bitte E-Mail und Passwort angeben.";
const ERR_INVALID_CREDS = "E-Mail oder Passwort stimmt nicht.";
const ERR_RATE_LIMITED = "Zu viele Anmelde-Versuche. Bitte einen Moment warten.";

function ipFromHeaders(xff: string | null, xri: string | null): string {
  return (xff ?? xri ?? "").split(",")[0]?.trim() || "unknown";
}

async function checkRateLimits(
  email: string,
  label: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hdrs = await headers();
  const ip = ipFromHeaders(
    hdrs.get("x-forwarded-for"),
    hdrs.get("x-real-ip")
  );
  const rl = await rateLimit(`${label}:email`, email, {
    limit: 10,
    windowSeconds: 60 * 60,
  });
  const rlIp = await rateLimit(`${label}:ip`, ip, {
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok || !rlIp.ok) {
    return { ok: false, error: ERR_RATE_LIMITED };
  }
  return { ok: true };
}

/**
 * Email + Passwort. Bei Erfolg State `{ ok: true, redirectTo: "/admin" }`;
 * die Client-Form macht router.push() darauf. Bei Fehler State mit Error.
 */
export async function adminPasswordLoginAction(
  _prev: AdminLoginActionState,
  formData: FormData
): Promise<AdminLoginActionState> {
  const parsed = PasswordSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: ERR_INVALID_INPUT };
  }
  const email = parsed.data.email.toLowerCase();

  const rl = await checkRateLimits(email, "admin-login");
  if (!rl.ok) return rl;

  // verifyAdminPassword läuft IMMER (auch für non-allowlisted Mails), damit
  // weder der Allowlist-Check noch das "kein Passwort gesetzt"-Signal per
  // Wall-Clock leakt. Die Funktion verwirft non-allowlisted Mails defensiv,
  // ruft aber trotzdem den argon2-Dummy-Verify aus @/auth/password auf.
  const match = await verifyAdminPassword(email, parsed.data.password);
  if (!match) {
    await writeAudit({
      actorEmail: email,
      action: "login",
      entityKind: "admin_login",
      diff: { method: "password", ok: false },
    });
    return { ok: false, error: ERR_INVALID_CREDS };
  }

  await createAdminSession(match.id);

  await writeAudit({
    actorEmail: email,
    action: "login",
    entityKind: "admin_login",
    diff: { method: "password", ok: true },
  });

  return { ok: true, redirectTo: "/admin" };
}

/**
 * Magic-Link-Fallback ("Lieber per Email-Link anmelden"). Silent no-op für
 * non-allowlisted Mails (Enumeration-Schutz). Returnt `{ ok: true }` damit
 * die Form inline "Posteingang prüfen" rendert — kein Redirect auf eine
 * separate /sent-Route nötig.
 */
export async function requestAdminMagicLinkAction(
  _prev: AdminMailActionState,
  formData: FormData
): Promise<AdminMailActionState> {
  const parsed = EmailOnlySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: ERR_INVALID_EMAIL };
  }
  const email = parsed.data.email.toLowerCase();

  const rl = await checkRateLimits(email, "admin-login");
  if (!rl.ok) return rl;

  await issueAdminMagicLink(email);
  await writeAudit({
    actorEmail: email,
    action: "magic_link_request",
    entityKind: "admin_login",
  });

  return { ok: true };
}

/**
 * "Passwort vergessen"-Pfad: schickt einen Reset-Link statt Login-Magic-Link.
 * Returnt `{ ok: true }` damit die Form inline rendert.
 */
export async function requestAdminPasswordResetAction(
  _prev: AdminMailActionState,
  formData: FormData
): Promise<AdminMailActionState> {
  const parsed = EmailOnlySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: ERR_INVALID_EMAIL };
  }
  const email = parsed.data.email.toLowerCase();

  const rl = await checkRateLimits(email, "admin-login");
  if (!rl.ok) return rl;

  await issueAdminPasswordResetLink(email);
  await writeAudit({
    actorEmail: email,
    action: "magic_link_request",
    entityKind: "admin_login",
    diff: { reason: "password_reset" },
  });

  return { ok: true };
}
