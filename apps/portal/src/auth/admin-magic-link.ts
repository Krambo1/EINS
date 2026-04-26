import "server-only";
import Redis from "ioredis";
import { env } from "@/lib/env";
import { generateToken, sha256Hex } from "@/lib/crypto";
import { sendMagicLinkEmail } from "@/server/email";
import { MAGIC_LINK_TTL_SECONDS } from "@/lib/constants";
import { isAdminEmail, ensureAdminUser, createAdminSession } from "./admin";

/**
 * Admin magic-link flow — token stored in Redis (NOT the clinic `magic_links`
 * table, which is FK'd to `clinic_users`). Key is the sha256 of the token,
 * value is the admin email, TTL is 15 minutes.
 *
 * Consumption deletes the key atomically (GETDEL) so a stolen link is single-use.
 */

declare global {
  // eslint-disable-next-line no-var
  var __einsAdminMlkRedis: Redis | undefined;
}

function redis(): Redis {
  if (!globalThis.__einsAdminMlkRedis) {
    globalThis.__einsAdminMlkRedis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    globalThis.__einsAdminMlkRedis.on("error", (err) => {
      console.error("[admin-mlk][redis]", err.message);
    });
  }
  return globalThis.__einsAdminMlkRedis;
}

const KEY_PREFIX = "adm:mlk:";

/**
 * Issue an admin magic link. Silently no-ops if the email isn't in
 * ADMIN_EMAILS so we don't leak the allowlist.
 */
export async function issueAdminMagicLink(email: string): Promise<void> {
  const lower = email.trim().toLowerCase();
  if (!isAdminEmail(lower)) return;

  const token = generateToken(32);
  const hash = sha256Hex(token);
  await redis().set(KEY_PREFIX + hash, lower, "EX", MAGIC_LINK_TTL_SECONDS);

  const url = `${env.APP_ORIGIN}/admin/login/callback?token=${token}`;
  await sendMagicLinkEmail({ to: lower, url, intent: "login" });
}

/**
 * Consume a token. On success:
 *   - deletes the Redis key (single-use)
 *   - ensures an admin_users row exists
 *   - creates an admin session
 *
 * Returns the admin email on success, null on failure.
 */
export async function consumeAdminMagicLink(token: string): Promise<string | null> {
  const hash = sha256Hex(token);
  // GETDEL is atomic — makes double-consumption impossible.
  const email = (await redis().getdel(KEY_PREFIX + hash)) as string | null;
  if (!email) return null;
  if (!isAdminEmail(email)) return null;

  const { id, mfaEnrolled } = await ensureAdminUser(email);
  await createAdminSession(id, { mfaVerified: !mfaEnrolled });
  return email;
}
