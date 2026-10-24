import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull, lt, ne, sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import { type CurrencyCode } from "../lib/formatting";
import {
  IMPERSONATION_SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_LAST_SEEN_THROTTLE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  SESSION_REMEMBER_MAX_AGE_SECONDS,
  type Role,
} from "../lib/constants";
import { deriveSigningKey, generateToken, sha256Hex } from "../lib/crypto";
import { trustedIpFromHeaders } from "../lib/client-ip";
import { avatarUrlForKey } from "../server/avatars";
import { isAdminEmail } from "./admin";
import { describeErrorForLog } from "../lib/error-log";
import {
  sessionMaxAgeSeconds,
  sessionRejectReason,
  shouldTouchLastSeen,
} from "./session-validity";

/**
 * Session layer for clinic users.
 *
 * Cookie shape: a short JWT (kid=session-v1) signed with SESSION_SECRET,
 * carrying only a random server-side session id + token. The token is kept
 * server-side hashed (sha256) in the `sessions` table so a leaked cookie
 * alone isn't enough to impersonate without the signing secret.
 *
 * Each sign-in emits a NEW row in `sessions`. Logout marks it revoked.
 * `getSession()` is called by every server component that needs auth.
 */

const SECRET = deriveSigningKey("session-v1");
const ALG = "HS256";

interface SessionCookiePayload {
  sid: string; // session row id (uuid)
  tok: string; // opaque random token — we store its hash in DB
}

async function signCookie(
  payload: SessionCookiePayload,
  maxAgeSeconds: number
): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG, kid: "session-v1" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(SECRET);
}

async function verifyCookie(token: string): Promise<SessionCookiePayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: [ALG] });
    if (typeof payload.sid !== "string" || typeof payload.tok !== "string") {
      return null;
    }
    return { sid: payload.sid, tok: payload.tok };
  } catch {
    return null;
  }
}

/** Shape returned by getSession() — a resolved, live, authorized context. */
export interface ResolvedSession {
  sessionId: string;
  userId: string;
  clinicId: string;
  /** Billing currency of the user's Praxis (clinics.currency). Drives money
   *  formatting for this clinic's own PVS revenue (EUR for DE/AT, CHF for a
   *  Swiss Praxis); agency-side spend/ROAS stay EUR regardless. */
  currency: CurrencyCode;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
  /** Non-null when an admin opened this session via "View as clinic user". */
  impersonatedByAdminId: string | null;
  /**
   * Absolute end of this session (sessions.expires_at). For an admin view it
   * is the 30-minute cap, so the banner can show the remaining time.
   */
  expiresAt: Date;
  /** Interactive portal-tour lifecycle (drives the first-login auto-prompt). */
  onboardingTourCompletedAt: Date | null;
  onboardingTourDismissedAt: Date | null;
  /** Set once the user dismisses the left-nav tour card; suppresses it for good. */
  onboardingTourNavCardDismissedAt: Date | null;
}

/**
 * Create a session row + set the encrypted cookie. Called from magic-link
 * consumption and from password-login.
 *
 * @param userId    clinic_user primary key
 * @param opts.impersonatedByAdminId set when an admin "View as user" flow
 *                                   opened this session; triggers the
 *                                   in-portal banner.
 * @param opts.rememberMe set from the "Angemeldet bleiben"-Häkchen on the login
 *                        form; extends the session from 8h to 30 days across the
 *                        JWT, cookie and sessions.expires_at in one shot.
 */
export async function createSession(
  userId: string,
  opts: { impersonatedByAdminId?: string; rememberMe?: boolean } = {}
): Promise<void> {
  // "Angemeldet bleiben" verlängert auf 30 Tage. Impersonation bleibt bewusst
  // kurzlebig (30 Minuten): ein Admin, der sich als User einloggt, soll keine
  // lange Session im Namen des Users öffnen, deshalb gewinnt
  // impersonatedByAdminId immer (B-25).
  const maxAgeSeconds = sessionMaxAgeSeconds(opts, {
    normal: SESSION_MAX_AGE_SECONDS,
    remember: SESSION_REMEMBER_MAX_AGE_SECONDS,
    impersonation: IMPERSONATION_SESSION_MAX_AGE_SECONDS,
  });
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

  const hdrs = await headers();
  const ua = hdrs.get("user-agent") ?? null;
  const ip = trustedIpFromHeaders(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));

  // Session rotation (B-14): a login on a device that still carries a session
  // cookie revokes that older row, so a shared Praxis computer never keeps two
  // live sessions (the old one would otherwise stay valid until it expires).
  const jarBefore = await cookies();
  const previousRaw = jarBefore.get(SESSION_COOKIE)?.value;
  if (previousRaw) {
    const previous = await verifyCookie(previousRaw);
    if (previous) {
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.sessions.id, previous.sid),
            eq(schema.sessions.tokenHash, sha256Hex(previous.tok)),
            isNull(schema.sessions.revokedAt)
          )
        );
    }
  }

  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId,
      tokenHash,
      impersonatedByAdminId: opts.impersonatedByAdminId,
      userAgent: ua ?? undefined,
      ipAddress: ip ?? undefined,
      expiresAt,
    })
    .returning({ id: schema.sessions.id });

  const cookie = await signCookie({ sid: row.id, tok: token }, maxAgeSeconds);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  // Bump last-login stamp — but NOT for impersonation (the real user didn't
  // actually log in; pretending they did would mislead the admin team list).
  if (!opts.impersonatedByAdminId) {
    await db
      .update(schema.clinicUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.clinicUsers.id, userId));
  }
}

/**
 * Look up the current session and its user. Returns null if unauthenticated.
 *
 * Wrapped in `React.cache` so duplicate calls inside one render share a single
 * DB lookup + lastSeenAt update -- e.g. layout + page + a permission check
 * all calling requireSession() now hit the DB once, not three times.
 */
async function getSessionImpl(): Promise<ResolvedSession | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const payload = await verifyCookie(raw);
  if (!payload) return null;

  const tokenHash = sha256Hex(payload.tok);

  // Superuser connection: RLS does not apply to session lookup (sessions table is
  // not clinic-scoped in the policy set — it's auth infrastructure).
  //
  // One round trip carries every lockout signal: user archived, clinic
  // archived (G-05 / B-12), and for impersonation sessions the impersonating
  // admin's email + whether that admin still holds a live admin session
  // (B-25). The EXISTS only runs for impersonation rows (CASE short-circuits).
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      userId: schema.sessions.userId,
      impersonatedByAdminId: schema.sessions.impersonatedByAdminId,
      expiresAt: schema.sessions.expiresAt,
      revokedAt: schema.sessions.revokedAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      clinicArchivedAt: schema.clinics.archivedAt,
      impersonatorEmail: schema.adminUsers.email,
      impersonatorHasActiveSession: dsql<boolean | null>`CASE
        WHEN ${schema.sessions.impersonatedByAdminId} IS NULL THEN NULL
        ELSE EXISTS (
          SELECT 1 FROM admin_sessions s
           WHERE s.admin_id = ${schema.sessions.impersonatedByAdminId}
             AND s.revoked_at IS NULL
             AND s.expires_at > now()
        )
      END`,
      clinicId: schema.clinicUsers.clinicId,
      currency: schema.clinics.currency,
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
      avatarKey: schema.clinicUsers.avatarKey,
      avatarUpdatedAt: schema.clinicUsers.avatarUpdatedAt,
      role: schema.clinicUsers.role,
      archivedAt: schema.clinicUsers.archivedAt,
      onboardingTourCompletedAt: schema.clinicUsers.onboardingTourCompletedAt,
      onboardingTourDismissedAt: schema.clinicUsers.onboardingTourDismissedAt,
      onboardingTourNavCardDismissedAt:
        schema.clinicUsers.onboardingTourNavCardDismissedAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.clinicUsers, eq(schema.sessions.userId, schema.clinicUsers.id))
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .leftJoin(
      schema.adminUsers,
      eq(schema.adminUsers.id, schema.sessions.impersonatedByAdminId)
    )
    .where(
      and(
        eq(schema.sessions.id, payload.sid),
        eq(schema.sessions.tokenHash, tokenHash)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const now = new Date();
  const rejected = sessionRejectReason(
    {
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
      userArchivedAt: row.archivedAt,
      clinicArchivedAt: row.clinicArchivedAt,
      impersonatedByAdminId: row.impersonatedByAdminId,
      impersonatorEmail: row.impersonatorEmail,
      impersonatorHasActiveSession: row.impersonatorHasActiveSession,
    },
    now,
    isAdminEmail
  );
  if (rejected) return null;

  // Touch lastSeen at most every SESSION_LAST_SEEN_THROTTLE_SECONDS (D-5 /
  // A-21): one UPDATE per 5 minutes instead of one per render, prefetch and
  // server action. The WHERE repeats the staleness check so concurrent
  // requests do not stack writes. Runs after the response via `after()`
  // (kept alive on Vercel); outside a request scope we fall back to a
  // detached promise. A missed update is cosmetic (admin "last seen").
  if (shouldTouchLastSeen(row.lastSeenAt, now, SESSION_LAST_SEEN_THROTTLE_SECONDS)) {
    const touch = () =>
      db
        .update(schema.sessions)
        .set({ lastSeenAt: new Date() })
        .where(
          and(
            eq(schema.sessions.id, row.sessionId),
            lt(
              schema.sessions.lastSeenAt,
              dsql`now() - (${SESSION_LAST_SEEN_THROTTLE_SECONDS}::int * interval '1 second')`
            )
          )
        )
        .then(
          () => undefined,
          (err: unknown) => {
            console.warn("[session] lastSeenAt update failed", JSON.stringify(describeErrorForLog(err)));
          }
        );
    try {
      after(touch);
    } catch {
      void touch();
    }
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    clinicId: row.clinicId,
    currency: row.currency as CurrencyCode,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: avatarUrlForKey(row.avatarKey, row.avatarUpdatedAt),
    role: row.role as Role,
    impersonatedByAdminId: row.impersonatedByAdminId,
    expiresAt: row.expiresAt,
    onboardingTourCompletedAt: row.onboardingTourCompletedAt,
    onboardingTourDismissedAt: row.onboardingTourDismissedAt,
    onboardingTourNavCardDismissedAt: row.onboardingTourNavCardDismissedAt,
  };
}

export const getSession = cache(getSessionImpl);

/**
 * True when the request carries a session cookie at all, valid or not. Lets
 * `requireSession` tell "Sitzung abgelaufen" apart from "nie angemeldet" (B-6).
 */
export async function hasSessionCookie(): Promise<boolean> {
  const jar = await cookies();
  return jar.has(SESSION_COOKIE);
}

/** Revoke the active session (logout). Tolerates missing cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    const payload = await verifyCookie(raw);
    if (payload) {
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.id, payload.sid));
    }
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Revoke every non-expired session for a user. Used after password reset
 * or admin "force-logout".
 */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        dsql`${schema.sessions.expiresAt} > now()`
      )
    );
}

/**
 * Revoke every non-expired session for a user EXCEPT the one passed in. Used
 * by /einstellungen/sicherheit password-change so the user keeps their current
 * tab logged in while other devices get kicked out.
 */
export async function revokeOtherSessionsForUser(
  userId: string,
  exceptSessionId: string
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        ne(schema.sessions.id, exceptSessionId),
        isNull(schema.sessions.revokedAt),
        dsql`${schema.sessions.expiresAt} > now()`
      )
    );
}
