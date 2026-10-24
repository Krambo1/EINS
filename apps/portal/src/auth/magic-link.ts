import "server-only";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { headers } from "next/headers";
import { after } from "next/server";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import { INVITE_LINK_TTL_SECONDS, MAGIC_LINK_TTL_SECONDS } from "../lib/constants";
import { generateToken, sha256Hex } from "../lib/crypto";
import { trustedIpFromHeaders } from "../lib/client-ip";
import { sendMagicLinkEmail } from "../server/email";
import { isEmailSuppressed } from "../server/email-suppression";
import { writeAudit } from "../server/audit";
import { createSession } from "./session";
import { findActiveClinicUserByEmail, findActiveClinicUserById } from "./user-lookup";
import {
  classifyLinkRow,
  isPlausibleLinkToken,
  magicLinkTtlSeconds,
  suppressionBlocksAuthMail,
} from "./magic-link-rules";

/**
 * Magic-link issuance and consumption.
 *
 * Flow:
 *  1. User submits their email on /login (or admin invites them).
 *  2. requestMagicLink() creates a row in `magic_links` with a hashed token
 *     and emails the cleartext token as part of the URL. We respond with a
 *     neutral "check your inbox" message regardless of whether the email
 *     maps to an existing user — defeats enumeration.
 *  3. User clicks the link. It opens /login/link (a page with a button, no
 *     auto-submit), which only PEEKS at the token. Mail scanners that
 *     prefetch links therefore cannot burn it (B-1). The button POSTs to
 *     /api/auth/callback, which calls consumeMagicLink(), which:
 *       - verifies the token hash matches a non-expired, non-consumed row
 *       - marks the row consumed
 *       - creates a session tied to the user
 *       - returns the user record so the caller can redirect to
 *         /dashboard (or the invite-handover page for new accounts).
 *
 * Rate-limiting is layered on top in the API route (see server actions).
 */

export type MagicLinkIntent =
  | "login"
  | "invite"
  | "set_password"
  | "reset_password";

interface IssueMagicLinkOpts {
  email: string;
  intent?: MagicLinkIntent;
  /** Optional pre-existing clinic_users row id. If provided, the link ties to that user. */
  userId?: string;
  /** Clinic display name — for the invite subject line. */
  clinicName?: string;
  /** Absolute origin for the callback URL. Defaults to APP_ORIGIN. */
  origin?: string;
}

/**
 * Outcome of issueMagicLink. Self-service callers (login, reset) MUST ignore
 * it and always show the neutral "Link unterwegs" message (enumeration
 * defence). The invite flow shows it honestly to the inviting Inhaber (B-3).
 */
export type MagicLinkIssueResult =
  | { status: "sent" }
  /** Delivery runs after the response (self-service intents, see below). */
  | { status: "queued" }
  | { status: "skipped"; reason: "no_user" | "suppressed" }
  | { status: "failed"; reason: "send_failed" };

/**
 * Create (and email) a magic link.
 *
 * Invitations need opts.userId (the freshly created / reactivated row). Every
 * other intent resolves the user by email through findActiveClinicUserByEmail
 * (active user in an active Praxis, oldest membership wins) and silently
 * skips unknown addresses.
 *
 * Timing (B-16): for self-service intents everything after the user lookup
 * (suppression check, token insert, Resend call) runs after the response via
 * `after()`. A known and an unknown address then cost the caller the same
 * single lookup query, so the answer time does not reveal whether an account
 * exists. Invitations run inline because the Inhaber must learn whether the
 * mail went out.
 */
export async function issueMagicLink(
  opts: IssueMagicLinkOpts
): Promise<MagicLinkIssueResult> {
  // Captured at function entry so the "Angefordert" chip in the email reflects
  // when the user actually triggered the flow, not when the (possibly queued)
  // send happens to render.
  const requestedAt = new Date();
  const email = opts.email.trim().toLowerCase();
  const intent = opts.intent ?? "login";
  const origin = opts.origin ?? env.APP_ORIGIN;

  let userId = opts.userId ?? null;
  let userClinicId: string | null = null;
  let recipientName: string | null = null;
  if (!userId && intent !== "invite") {
    const existing = await findActiveClinicUserByEmail(email);
    if (!existing) return { status: "skipped", reason: "no_user" }; // silent for the caller
    userId = existing.id;
    userClinicId = existing.clinicId;
    recipientName = existing.fullName;
  } else if (userId) {
    const [u] = await db
      .select({
        clinicId: schema.clinicUsers.clinicId,
        fullName: schema.clinicUsers.fullName,
      })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, userId))
      .limit(1);
    userClinicId = u?.clinicId ?? null;
    recipientName = u?.fullName ?? null;
  } else {
    return { status: "skipped", reason: "no_user" };
  }

  const hdrs = await headers();
  const ip = trustedIpFromHeaders(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));
  const ua = hdrs.get("user-agent") ?? null;

  // Self-service intents run this after the response (see Timing above).
  const issue = async (): Promise<MagicLinkIssueResult> => {
    // Suppression (B-10): a hard bounce or a manual EINS block stops every auth
    // mail; a spam complaint only stops invitations. See
    // suppressionBlocksAuthMail for the reasoning.
    if (userClinicId) {
      const reason = await isEmailSuppressed(userClinicId, email, "transactional");
      if (suppressionBlocksAuthMail(intent, reason)) {
        console.warn(
          `[magic-link] suppressed intent=${intent} clinic=${clinicLogRef(userClinicId)} reason=${reason}`
        );
        await writeAudit({
          clinicId: userClinicId,
          actorId: userId,
          action: "email_suppressed",
          entityKind: "magic_link",
          diff: { intent, reason },
        });
        return { status: "skipped", reason: "suppressed" };
      }
    }

    const token = generateToken(32);
    const tokenHash = sha256Hex(token);
    const ttlSeconds = magicLinkTtlSeconds(intent, {
      login: MAGIC_LINK_TTL_SECONDS,
      invite: INVITE_LINK_TTL_SECONDS,
    });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await db.insert(schema.magicLinks).values({
      email,
      tokenHash,
      userId: userId ?? undefined,
      intent,
      expiresAt,
      requestIp: ip ?? undefined,
    });

    // The link opens the read-only landing page; only its button consumes the
    // token (B-1). Old /api/auth/callback?token= links still work: GET there
    // forwards to this page.
    const url = `${origin.replace(/\/$/, "")}/login/link?token=${encodeURIComponent(token)}`;

    const clinicIdForAudit = userClinicId;
    const userIdForAudit = userId;
    // Email-Send-Fehler dürfen die Aktion nicht abbrechen: der Magic-Link-Row
    // bleibt gültig, ein Retry hilft bei Resend-Ausfall nicht. Sichtbarkeit:
    // `[CRITICAL]`-Log + Audit-Row action="email_send_failed". Kein Empfänger
    // im Log (Datenschutz), die Audit-Row trägt actorId/clinicId.
    const deliver = async (): Promise<boolean> => {
      try {
        await sendMagicLinkEmail({
          to: email,
          url,
          intent,
          clinicName: opts.clinicName,
          recipientName,
          requestedAt,
        });
        return true;
      } catch (err) {
        console.error(
          `[CRITICAL] [magic-link] sendMagicLinkEmail failed intent=${intent} clinic=${clinicLogRef(clinicIdForAudit)}:`,
          maskAddresses(err instanceof Error ? err.message : String(err))
        );
        try {
          await writeAudit({
            clinicId: clinicIdForAudit,
            actorId: userIdForAudit ?? null,
            actorEmail: email,
            action: "email_send_failed",
            entityKind: "magic_link",
            diff: {
              intent,
              error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
            },
            requestMeta: { ip, ua },
            impersonatedByAdminId: null,
          });
        } catch {
          // already logged above
        }
        return false;
      }
    };

    return (await deliver())
      ? { status: "sent" }
      : { status: "failed", reason: "send_failed" };
  };

  if (intent === "invite") return await issue();

  try {
    after(async () => {
      try {
        await issue();
      } catch (err) {
        // DB failure after the response; no recipient in the log.
        console.error(
          `[CRITICAL] [magic-link] deferred issue failed intent=${intent} clinic=${clinicLogRef(userClinicId)}:`,
          err instanceof Error ? err.name : typeof err
        );
      }
    });
    return { status: "queued" };
  } catch {
    // Outside a request scope (scripts): run inline.
    return await issue();
  }
}

/**
 * A-12: log lines carry a hashed clinic id (same 12-char sha256 prefix as
 * `clinicLogId` in db/client.ts) and never an address; provider error texts
 * are masked because some echo the recipient.
 */
function clinicLogRef(clinicId: string | null): string {
  return clinicId ? sha256Hex(clinicId).slice(0, 12) : "-";
}

function maskAddresses(text: string): string {
  return text.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "<adresse>");
}

export type MagicLinkPeekResult =
  | { ok: true; intent: MagicLinkIntent }
  | {
      ok: false;
      reason: "invalid" | "expired" | "consumed" | "no_user";
      intent?: MagicLinkIntent;
    };

/**
 * Read-only look at a token for the /login/link landing page (B-1). Never
 * writes: a mail scanner that fetches the link learns nothing and burns
 * nothing. The real check happens again inside the consuming transaction.
 */
export async function peekMagicLink(token: string): Promise<MagicLinkPeekResult> {
  if (!isPlausibleLinkToken(token)) return { ok: false, reason: "invalid" };
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({
      intent: schema.magicLinks.intent,
      expiresAt: schema.magicLinks.expiresAt,
      consumedAt: schema.magicLinks.consumedAt,
      userId: schema.magicLinks.userId,
      userArchivedAt: schema.clinicUsers.archivedAt,
      clinicArchivedAt: schema.clinics.archivedAt,
    })
    .from(schema.magicLinks)
    .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.magicLinks.userId))
    .leftJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(eq(schema.magicLinks.tokenHash, tokenHash))
    .limit(1);
  const intent = row?.intent as MagicLinkIntent | undefined;
  const reason = classifyLinkRow(
    row
      ? {
          consumedAt: row.consumedAt,
          expiresAt: row.expiresAt,
          userActive:
            row.userId !== null && !row.userArchivedAt && !row.clinicArchivedAt,
        }
      : null,
    new Date()
  );
  if (reason) return { ok: false, reason, intent };
  return { ok: true, intent: intent ?? "login" };
}

export type ConsumeResult =
  | {
      ok: true;
      userId: string;
      clinicId: string;
      intent: "login";
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_user" };

export type PasswordConsumeResult =
  | {
      ok: true;
      userId: string;
      clinicId: string;
      /** "invite" is routed through the password-setup cookie as well: an
       *  invited member gets NO session until a password exists (B-16, B-8). */
      intent: "set_password" | "reset_password" | "invite";
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_user" };

/**
 * Validate a LOGIN token and, on success, consume the row + create a session.
 * Only ever called from the POST handler of /api/auth/callback (B-1).
 *
 * All lookups and writes happen in a single transaction so the "consume" check
 * is race-safe across multiple tabs.
 */
export async function consumeMagicLink(token: string): Promise<ConsumeResult> {
  if (!isPlausibleLinkToken(token)) return { ok: false, reason: "invalid" };
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
    // Defense-in-depth: this consumer only mints sessions for login.
    // Set-/reset-password and invite tokens go through
    // consumeMagicLinkForPasswordSetup (which marks consumed without minting
    // a session — the password write happens later in the set-password
    // action). The callback tries password-setup first, so a wrong intent
    // reaching here means someone tried to bypass that — reject loudly.
    if (row.intent !== "login") {
      return { ok: false, reason: "invalid" as const };
    }

    const userId = row.userId;
    if (!userId) return { ok: false, reason: "no_user" as const };

    // Active user in an active Praxis (G-05 / B-12).
    const user = await findActiveClinicUserById(userId, tx);
    if (!user) return { ok: false, reason: "no_user" as const };

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
      intent: "login" as const,
    };
  });

  if (!outcome.ok) return outcome;

  await createSession(outcome.userId);
  return outcome;
}

/**
 * Atomically consume a set-/reset-password magic-link — marks the row consumed
 * and returns the resolved userId/clinicId/intent. Does NOT write a password
 * and does NOT mint a session — both happen later in the set-password action,
 * after the user has actually submitted a new password through the cookie-
 * handover form.
 *
 * Called from the POST handler of /api/auth/callback (the button on
 * /login/link), never on a GET (B-1). The userId is then
 * stored in a short-lived httpOnly cookie via `issuePasswordSetupCookie` so
 * the URL never carries the magic-link token through the form render.
 */
export async function consumeMagicLinkForPasswordSetup(
  token: string
): Promise<PasswordConsumeResult> {
  if (!isPlausibleLinkToken(token)) return { ok: false, reason: "invalid" };
  const tokenHash = sha256Hex(token);

  const outcome: PasswordConsumeResult = await db.transaction(async (tx): Promise<PasswordConsumeResult> => {
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
    if (
      row.intent !== "set_password" &&
      row.intent !== "reset_password" &&
      row.intent !== "invite"
    ) {
      return { ok: false, reason: "invalid" as const };
    }
    const userId = row.userId;
    if (!userId) return { ok: false, reason: "no_user" as const };

    // Active user in an active Praxis (G-05 / B-12).
    const user = await findActiveClinicUserById(userId, tx);
    if (!user) return { ok: false, reason: "no_user" as const };

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
      intent: row.intent as "set_password" | "reset_password" | "invite",
    };
  });

  return outcome;
}

/**
 * Housekeeping — called from the weekly purge-audit worker job. Drops expired +
 * long-consumed magic-link rows so the table doesn't grow unbounded.
 */
export async function purgeExpiredMagicLinks(): Promise<number> {
  const result = await db
    .delete(schema.magicLinks)
    .where(
      dsql`${schema.magicLinks.expiresAt} < now() - interval '7 days'
        OR ${schema.magicLinks.consumedAt} < now() - interval '7 days'`
    );
  return (
    (result as unknown as { count?: number }).count ??
    (result as unknown as { rowCount?: number }).rowCount ??
    0
  );
}
