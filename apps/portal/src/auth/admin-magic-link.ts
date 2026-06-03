import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { adminOrigin } from "@/lib/env";
import { generateToken, sha256Hex } from "@/lib/crypto";
import { sendMagicLinkEmail } from "@/server/email";
import { MAGIC_LINK_TTL_SECONDS } from "@/lib/constants";
import { isAdminEmail, ensureAdminUser, createAdminSession } from "./admin";

/**
 * Admin magic-link flow — token stored in the `admin_tokens` table (NOT the
 * clinic `magic_links` table, which is FK'd to `clinic_users`). We store the
 * sha256 of the token with `purpose = 'login'` and a 15-minute expiry.
 *
 * Consumption is a `DELETE ... RETURNING` filtered on a non-expired row, which
 * is atomic — so a stolen link is single-use (same guarantee the old Redis
 * GETDEL gave). The table is superuser-only (see migration 0059), accessed via
 * the `db` connection.
 */

const TOKEN_PURPOSE = "login";

/**
 * Issue an admin magic link. Silently no-ops if the email isn't in
 * ADMIN_EMAILS so we don't leak the allowlist.
 */
export async function issueAdminMagicLink(email: string): Promise<void> {
  const requestedAt = new Date();
  const lower = email.trim().toLowerCase();
  if (!isAdminEmail(lower)) return;

  const token = generateToken(32);
  const hash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);

  await db
    .insert(schema.adminTokens)
    .values({ tokenHash: hash, email: lower, purpose: TOKEN_PURPOSE, expiresAt })
    // 32 random bytes never realistically collide, but stay robust if they do.
    .onConflictDoUpdate({
      target: schema.adminTokens.tokenHash,
      set: { email: lower, purpose: TOKEN_PURPOSE, expiresAt },
    });

  const url = `${adminOrigin()}/admin/login/callback?token=${token}`;
  await sendMagicLinkEmail({ to: lower, url, intent: "login", requestedAt });
}

/**
 * Consume a token. On success:
 *   - deletes the token row (single-use, atomic via DELETE ... RETURNING)
 *   - ensures an admin_users row exists
 *   - creates an admin session
 *
 * Returns the admin email on success, null on failure.
 */
export async function consumeAdminMagicLink(token: string): Promise<string | null> {
  const hash = sha256Hex(token);
  // DELETE ... RETURNING on a non-expired row is atomic — double-consumption
  // impossible. A password-reset token won't match (purpose filter), so the
  // shared callback can try this after the password-setup path.
  const [row] = await db
    .delete(schema.adminTokens)
    .where(
      and(
        eq(schema.adminTokens.tokenHash, hash),
        eq(schema.adminTokens.purpose, TOKEN_PURPOSE),
        gt(schema.adminTokens.expiresAt, sql`now()`)
      )
    )
    .returning({ email: schema.adminTokens.email });

  if (!row) return null;
  if (!isAdminEmail(row.email)) return null;

  const { id } = await ensureAdminUser(row.email);
  await createAdminSession(id);
  return row.email;
}
