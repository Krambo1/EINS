import "server-only";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import { MAGIC_LINK_TTL_SECONDS } from "../lib/constants";
import { generateToken, sha256Hex } from "../lib/crypto";
import { sendMagicLinkEmail } from "../server/email";
import { createSession } from "./session";

/**
 * Magic-link issuance and consumption.
 *
 * Flow:
 *  1. User submits their email on /login (or admin invites them).
 *  2. requestMagicLink() creates a row in `magic_links` with a hashed token
 *     and emails the cleartext token as part of the URL. We respond with a
 *     neutral "check your inbox" message regardless of whether the email
 *     maps to an existing user — defeats enumeration.
 *  3. User clicks the link. The /api/auth/callback route calls consumeMagicLink(),
 *     which:
 *       - verifies the token hash matches a non-expired, non-consumed row
 *       - marks the row consumed
 *       - creates a session tied to the user
 *       - returns the user record so the caller can redirect to
 *         /login/mfa (if MFA enrolled) or /onboarding (if not).
 *
 * Rate-limiting is layered on top in the API route (see server actions).
 */

interface IssueMagicLinkOpts {
  email: string;
  intent?: "login" | "invite";
  /** Optional pre-existing clinic_users row id. If provided, the link ties to that user. */
  userId?: string;
  /** Clinic display name — for the invite subject line. */
  clinicName?: string;
  /** Absolute origin for the callback URL. Defaults to APP_ORIGIN. */
  origin?: string;
}

/**
 * Create (and email) a magic link.
 *
 * If no user matches the email, we still create the row IF intent=invite and
 * userId is present. Otherwise we silently skip (login without an account
 * should behave identically to login with an account from the client's POV).
 */
export async function issueMagicLink(opts: IssueMagicLinkOpts): Promise<void> {
  const email = opts.email.trim().toLowerCase();
  const intent = opts.intent ?? "login";
  const origin = opts.origin ?? env.APP_ORIGIN;

  // For `login` intent we resolve the user by email so the token row carries
  // user_id for fast consumption. If no user matches, do nothing (neutral).
  let userId = opts.userId ?? null;
  if (!userId && intent === "login") {
    const existing = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.email, email),
          isNull(schema.clinicUsers.archivedAt)
        )
      )
      .limit(1);
    userId = existing[0]?.id ?? null;
    if (!userId) return; // silent drop — don't reveal account existence
  }

  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);

  const hdrs = await headers();
  const ip = parseRequestIp(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));

  await db.insert(schema.magicLinks).values({
    email,
    tokenHash,
    userId: userId ?? undefined,
    intent,
    expiresAt,
    requestIp: ip ?? undefined,
  });

  const url = `${origin.replace(/\/$/, "")}/api/auth/callback?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail({
    to: email,
    url,
    intent,
    clinicName: opts.clinicName,
  });
}

export type ConsumeResult =
  | {
      ok: true;
      userId: string;
      clinicId: string;
      mfaEnrolled: boolean;
      intent: "login" | "invite";
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_user" };

/**
 * Validate the token and, on success, consume the row + create an unverified
 * session. Caller decides where to redirect next based on `mfaEnrolled` + intent.
 *
 * All lookups and writes happen in a single transaction so the "consume" check
 * is race-safe across multiple tabs.
 */
export async function consumeMagicLink(token: string): Promise<ConsumeResult> {
  const tokenHash = sha256Hex(token);

  const outcome: ConsumeResult = await db.transaction(async (tx): Promise<ConsumeResult> => {
    const rows = await tx
      .select({
        id: schema.magicLinks.id,
        email: schema.magicLinks.email,
        userId: schema.magicLinks.userId,
        intent: schema.magicLinks.intent,
        expiresAt: schema.magicLinks.expiresAt,
        consumedAt: schema.magicLinks.consumedAt,
      })
      .from(schema.magicLinks)
      .where(eq(schema.magicLinks.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) return { ok: false, reason: "invalid" as const };
    if (row.consumedAt) return { ok: false, reason: "consumed" as const };
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "expired" as const };
    }

    // Resolve the user. For invite intent the userId MUST be set at issuance.
    const userId = row.userId;
    if (!userId) return { ok: false, reason: "no_user" as const };

    const users = await tx
      .select({
        id: schema.clinicUsers.id,
        clinicId: schema.clinicUsers.clinicId,
        email: schema.clinicUsers.email,
        mfaEnrolled: schema.clinicUsers.mfaEnrolled,
        archivedAt: schema.clinicUsers.archivedAt,
      })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, userId))
      .limit(1);

    const user = users[0];
    if (!user || user.archivedAt) return { ok: false, reason: "no_user" as const };

    // Mark consumed. Conditional update guards against concurrent consume.
    const consumed = await tx
      .update(schema.magicLinks)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(schema.magicLinks.id, row.id),
          isNull(schema.magicLinks.consumedAt)
        )
      )
      .returning({ id: schema.magicLinks.id });

    if (consumed.length === 0) {
      return { ok: false, reason: "consumed" as const };
    }

    return {
      ok: true as const,
      userId: user.id,
      clinicId: user.clinicId,
      mfaEnrolled: user.mfaEnrolled,
      intent: row.intent as "login" | "invite",
    };
  });

  if (!outcome.ok) return outcome;

  // Create an unverified session (MFA check happens on the next screen).
  await createSession(outcome.userId, { mfaVerified: false });
  return outcome;
}

/**
 * Housekeeping — called from cron.ts. Drops expired + long-consumed magic-link
 * rows so the table doesn't grow unbounded.
 */
export async function purgeExpiredMagicLinks(): Promise<number> {
  const result = await db
    .delete(schema.magicLinks)
    .where(
      dsql`${schema.magicLinks.expiresAt} < now() - interval '7 days'
        OR ${schema.magicLinks.consumedAt} < now() - interval '7 days'`
    );
  // postgres-js / drizzle doesn't report affected rows on delete — return count via a follow-up select if needed.
  // We swallow here; cron just wants the side-effect.
  void result;
  return 0;
}

function parseRequestIp(xff: string | null, xri: string | null): string | null {
  const first = (xff ?? xri ?? "").split(",")[0]?.trim();
  return first || null;
}
