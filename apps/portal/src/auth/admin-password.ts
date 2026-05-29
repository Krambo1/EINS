import "server-only";
import Redis from "ioredis";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env, adminOrigin } from "../lib/env";
import { generateToken, sha256Hex } from "../lib/crypto";
import { MAGIC_LINK_TTL_SECONDS } from "../lib/constants";
import { sendMagicLinkEmail } from "../server/email";
import { hashPassword } from "./password";
import {
  isAdminEmail,
  ensureAdminUser,
} from "./admin";

/**
 * Admin Password-Reset / Set-Password Flow.
 *
 * Anders als bei clinic_users existiert für admin_users keine magic_links-
 * Tabelle (admin_users hat keinen clinic_id FK). Wir nutzen Redis als Token-
 * Store mit eigenem Prefix, analog zu admin-magic-link.ts.
 *
 * Workflow (post-Härtung):
 *   1. issueAdminPasswordResetLink(email) → Redis-Key `adm:pwd:<hash>` mit
 *      Wert email, TTL 15 min. Mail wird verschickt. URL zeigt auf
 *      /admin/login/callback?token=… (NICHT mehr direkt auf set-password).
 *   2. User klickt Link → /admin/login/callback ruft consumeAdminPasswordSetupToken
 *      auf (GETDEL, atomar). Bei Erfolg: issuePasswordSetupCookie("admin", …)
 *      und Redirect auf /admin/set-password — clean URL, kein Token mehr.
 *   3. User submitted Passwort → setAdminPasswordAction liest die Cookie,
 *      ruft writeAdminPasswordHash auf, widerruft alle bestehenden Sessions
 *      + Trust-Devices, mintet frische Session.
 *
 * Begründung der Cookie-Schicht: Der vorherige Direkt-auf-Page-Link hat den
 * cleartext-Token während des gesamten Form-Rendering im URL gehalten. Damit
 * leakte er via History, Server-Access-Logs und Referer-Header.
 */

declare global {
  // eslint-disable-next-line no-var
  var __einsAdminPwdRedis: Redis | undefined;
}

function redis(): Redis {
  if (!globalThis.__einsAdminPwdRedis) {
    globalThis.__einsAdminPwdRedis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    globalThis.__einsAdminPwdRedis.on("error", (err) => {
      console.error("[admin-pwd][redis]", err.message);
    });
  }
  return globalThis.__einsAdminPwdRedis;
}

export const ADMIN_PASSWORD_TOKEN_PREFIX = "adm:pwd:";

/**
 * Issue a one-time password-set/reset link. Silent no-op for non-allowlisted
 * emails, so the enumeration surface stays neutral.
 *
 * Der Link führt auf /admin/login/callback — die Route entscheidet anhand
 * der Redis-Key-Prefix (adm:mlk: vs adm:pwd:) ob Login- oder Set-Password-
 * Flow greift. Vorher zeigte der Link direkt auf /admin/set-password?token=…
 * was den Token während der Form-Lifetime im URL liegen ließ (History/
 * Logs/Referer-Leak).
 */
export async function issueAdminPasswordResetLink(email: string): Promise<void> {
  const requestedAt = new Date();
  const lower = email.trim().toLowerCase();
  if (!isAdminEmail(lower)) return;

  const token = generateToken(32);
  const hash = sha256Hex(token);
  await redis().set(
    ADMIN_PASSWORD_TOKEN_PREFIX + hash,
    lower,
    "EX",
    MAGIC_LINK_TTL_SECONDS
  );

  const url = `${adminOrigin()}/admin/login/callback?token=${token}`;
  await sendMagicLinkEmail({
    to: lower,
    url,
    intent: "reset_password",
    requestedAt,
  });
}

/**
 * Atomically consume an admin password-setup token (GETDEL). Used by the
 * callback to verify a fresh Magic-Link and immediately exchange it for a
 * short-lived setup cookie. Returns the resolved admin id+email, or null on
 * miss.
 *
 * The previous design held the token in the URL until the form submit
 * (`peekAdminPasswordToken` → `consumeAdminPasswordToken`). That leaked the
 * token via browser history, server logs, and Referer headers. We now burn
 * the token at the callback and hand off via a signed httpOnly cookie.
 */
export async function consumeAdminPasswordSetupToken(
  token: string
): Promise<{ id: string; email: string } | null> {
  const hash = sha256Hex(token);
  const email = (await redis().getdel(
    ADMIN_PASSWORD_TOKEN_PREFIX + hash
  )) as string | null;
  if (!email) return null;
  if (!isAdminEmail(email)) return null;

  // ensureAdminUser ist idempotent — auf der ersten Reset-Anforderung legt es
  // die Row an, ab dann gibt es immer dieselbe id.
  const { id } = await ensureAdminUser(email);
  return { id, email };
}

/**
 * Write a new password hash directly for an admin (used by the cookie-based
 * set-password action after the user has submitted the form). Separated from
 * the token-consumption logic because the token is already burned at this
 * point.
 */
export async function writeAdminPasswordHash(
  adminId: string,
  plainPassword: string
): Promise<void> {
  const pwHash = await hashPassword(plainPassword);
  await db
    .update(schema.adminUsers)
    .set({ passwordHash: pwHash, passwordSetAt: new Date() })
    .where(eq(schema.adminUsers.id, adminId));
}

/**
 * Verify a plaintext admin password against the stored hash. Returns the
 * admin row id on match, null otherwise.
 *
 * Timing-safe: läuft verifyPassword IMMER (auch für non-allowlisted Mails
 * oder Admin-Rows ohne password_hash) damit weder der Allowlist-Check noch
 * das "kein Passwort gesetzt"-Signal per Wall-Clock leakt. Die finale
 * Allowlist/Hash-Validierung passiert erst NACH dem argon2-Verify.
 */
export async function verifyAdminPassword(
  email: string,
  plainPassword: string
): Promise<{ id: string } | null> {
  const lower = email.trim().toLowerCase();
  const allowlisted = isAdminEmail(lower);

  // Lookup läuft auch für non-allowlisted Mails: die Query ist günstig und
  // gibt einer Timing-Analyse nichts an die Hand. Bei non-allowlisted wirds
  // einfach kein Row geben; verifyPassword fällt dann auf den Dummy-Hash zurück.
  const [row] = await db
    .select({
      id: schema.adminUsers.id,
      passwordHash: schema.adminUsers.passwordHash,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, lower))
    .limit(1);

  const { verifyPassword } = await import("./password");
  const ok = await verifyPassword(row?.passwordHash, plainPassword);

  if (!allowlisted || !row || !ok) return null;
  return { id: row.id };
}
