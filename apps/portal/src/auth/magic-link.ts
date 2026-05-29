import "server-only";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import { MAGIC_LINK_TTL_SECONDS } from "../lib/constants";
import { generateToken, sha256Hex } from "../lib/crypto";
import { sendMagicLinkEmail } from "../server/email";
import { isEmailSuppressed } from "../server/email-suppression";
import { writeAudit } from "../server/audit";
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
 * Create (and email) a magic link.
 *
 * If no user matches the email, we still create the row IF intent=invite and
 * userId is present. Otherwise we silently skip (login without an account
 * should behave identically to login with an account from the client's POV).
 */
export async function issueMagicLink(opts: IssueMagicLinkOpts): Promise<void> {
  // Captured at function entry so the "Angefordert" chip in the email reflects
  // when the user actually triggered the flow, not when the (possibly queued)
  // send happens to render.
  const requestedAt = new Date();
  const email = opts.email.trim().toLowerCase();
  const intent = opts.intent ?? "login";
  const origin = opts.origin ?? env.APP_ORIGIN;

  // Für login/set_password/reset_password lösen wir den User by email auf.
  // Bei invite muss userId vom Aufrufer kommen (frischer Account hat noch
  // keine email-Eindeutigkeit).
  const resolveByEmail =
    intent === "login" ||
    intent === "set_password" ||
    intent === "reset_password";

  let userId = opts.userId ?? null;
  let userClinicId: string | null = null;
  let recipientName: string | null = null;
  if (!userId && resolveByEmail) {
    const existing = await db
      .select({
        id: schema.clinicUsers.id,
        clinicId: schema.clinicUsers.clinicId,
        fullName: schema.clinicUsers.fullName,
      })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.email, email),
          isNull(schema.clinicUsers.archivedAt)
        )
      )
      .limit(1);
    userId = existing[0]?.id ?? null;
    userClinicId = existing[0]?.clinicId ?? null;
    recipientName = existing[0]?.fullName ?? null;
    if (!userId) return; // silent drop — don't reveal account existence
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
  }

  // Suppression — only hard signals (bounced/complained/manual) block
  // transactional sends like magic-links. An unsubscribed user can still
  // receive their login link because login is operationally required.
  if (userClinicId) {
    const reason = await isEmailSuppressed(userClinicId, email, "transactional");
    if (reason) {
      console.log(
        `[magic-link] suppressed to=${email} clinic=${userClinicId} reason=${reason}`
      );
      return;
    }
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
  // Email-Send-Fehler dürfen die Aktion nicht abbrechen.
  //
  // Verhalten ist über Dev/Prod hinweg identisch: swallow + log + audit. Throw
  // wäre falsch, weil
  //   1. der User in beiden Fällen die "Link unterwegs"-Confirmation sehen muss
  //      (sonst leaked ein 500, dass die Adresse im System existiert — der
  //      silent-drop für unknown-emails oben hängt davon ab, dass known-emails
  //      bei Send-Fehler dieselbe Response geben);
  //   2. ein Retry der Aktion hilft dem User nichts, wenn Resend down ist;
  //   3. der Magic-Link-Row in der DB bleibt gültig — falls die Email doch noch
  //      ankommt (Queue-Replay, Driver-Wechsel), funktioniert der Link.
  //
  // Operationelle Sichtbarkeit: `[CRITICAL]`-Präfix im stdout-Log (für log-grep
  // alerts) + Audit-Row mit action="email_send_failed". In Prod sollten Alerts
  // auf beides feuern — sonst sind kaputte Magic-Links unsichtbar.
  try {
    await sendMagicLinkEmail({
      to: email,
      url,
      intent,
      clinicName: opts.clinicName,
      recipientName,
      requestedAt,
    });
  } catch (err) {
    console.error(
      `[CRITICAL] [magic-link] sendMagicLinkEmail failed to=${email} intent=${intent}:`,
      err
    );
    // Audit-Write darf selbst nicht crashen — writeAudit swallowt eigene
    // Fehler intern. Wir fangen trotzdem defensiv, falls das mal bricht.
    try {
      await writeAudit({
        clinicId: userClinicId,
        actorId: userId ?? null,
        actorEmail: email,
        action: "email_send_failed",
        entityKind: "magic_link",
        diff: {
          intent,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // already logged above
    }
  }
}

export type ConsumeResult =
  | {
      ok: true;
      userId: string;
      clinicId: string;
      intent: "login" | "invite";
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_user" };

export type PasswordConsumeResult =
  | {
      ok: true;
      userId: string;
      clinicId: string;
      intent: "set_password" | "reset_password";
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_user" };

/**
 * Validate the token and, on success, consume the row + create a session.
 * Caller decides where to redirect next based on intent.
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
    // Defense-in-depth: this consumer only mints sessions for login/invite.
    // Set-/reset-password tokens go through consumeMagicLinkForPasswordSetup
    // (which marks consumed without minting a session — the password write
    // happens later in the set-password action). The callback tries password-
    // setup first, so a wrong intent reaching here means someone tried to
    // bypass that — reject loudly.
    if (row.intent !== "login" && row.intent !== "invite") {
      return { ok: false, reason: "invalid" as const };
    }

    // Resolve the user. For invite intent the userId MUST be set at issuance.
    const userId = row.userId;
    if (!userId) return { ok: false, reason: "no_user" as const };

    const users = await tx
      .select({
        id: schema.clinicUsers.id,
        clinicId: schema.clinicUsers.clinicId,
        email: schema.clinicUsers.email,
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
      intent: row.intent as "login" | "invite",
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
 * Called from the /api/auth/callback route on landing. The userId is then
 * stored in a short-lived httpOnly cookie via `issuePasswordSetupCookie` so
 * the URL never carries the magic-link token through the form render.
 */
export async function consumeMagicLinkForPasswordSetup(
  token: string
): Promise<PasswordConsumeResult> {
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
    if (row.intent !== "set_password" && row.intent !== "reset_password") {
      return { ok: false, reason: "invalid" as const };
    }
    const userId = row.userId;
    if (!userId) return { ok: false, reason: "no_user" as const };

    const users = await tx
      .select({
        id: schema.clinicUsers.id,
        clinicId: schema.clinicUsers.clinicId,
        archivedAt: schema.clinicUsers.archivedAt,
      })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, userId))
      .limit(1);

    const user = users[0];
    if (!user || user.archivedAt) return { ok: false, reason: "no_user" as const };

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
      intent: row.intent as "set_password" | "reset_password",
    };
  });

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
