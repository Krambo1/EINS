import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type Role,
} from "../lib/constants";
import { generateToken, sha256Hex } from "../lib/crypto";

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
 *
 * We split "has session" from "has MFA verified" so magic-link step 1
 * creates a session in `mfaVerified=false` state; the TOTP step flips it.
 * Protected routes require `mfaVerified=true` when `user.mfaEnrolled=true`.
 */

const SECRET = new TextEncoder().encode(env.SESSION_SECRET);
const ALG = "HS256";

interface SessionCookiePayload {
  sid: string; // session row id (uuid)
  tok: string; // opaque random token — we store its hash in DB
}

async function signCookie(payload: SessionCookiePayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG, kid: "session-v1" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
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
  email: string;
  fullName: string | null;
  role: Role;
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  uiMode: "einfach" | "detail";
  /** Non-null when an admin opened this session via "View as clinic user". */
  impersonatedByAdminId: string | null;
}

/**
 * Create a session row + set the encrypted cookie.
 * Called from magic-link consumption AND from MFA verify (to rotate after step-up).
 *
 * @param userId    clinic_user primary key
 * @param opts.mfaVerified whether this session is already past the MFA step
 * @param opts.impersonatedByAdminId set when an admin "View as user" flow opened
 *                                   this session — disables MFA gates and
 *                                   triggers the in-portal banner.
 */
export async function createSession(
  userId: string,
  opts: { mfaVerified?: boolean; impersonatedByAdminId?: string } = {}
): Promise<void> {
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const hdrs = await headers();
  const ua = hdrs.get("user-agent") ?? null;
  const ip = parseRequestIp(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));

  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId,
      tokenHash,
      mfaVerified: opts.mfaVerified ?? false,
      impersonatedByAdminId: opts.impersonatedByAdminId,
      userAgent: ua ?? undefined,
      ipAddress: ip ?? undefined,
      expiresAt,
    })
    .returning({ id: schema.sessions.id });

  const cookie = await signCookie({ sid: row.id, tok: token });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
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

/** Flip mfaVerified=true on the current session (after TOTP success). */
export async function markSessionMfaVerified(sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ mfaVerified: true, lastSeenAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
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
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      userId: schema.sessions.userId,
      mfaVerifiedSession: schema.sessions.mfaVerified,
      impersonatedByAdminId: schema.sessions.impersonatedByAdminId,
      expiresAt: schema.sessions.expiresAt,
      revokedAt: schema.sessions.revokedAt,
      clinicId: schema.clinicUsers.clinicId,
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
      role: schema.clinicUsers.role,
      mfaEnrolled: schema.clinicUsers.mfaEnrolled,
      uiMode: schema.clinicUsers.uiMode,
      archivedAt: schema.clinicUsers.archivedAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.clinicUsers, eq(schema.sessions.userId, schema.clinicUsers.id))
    .where(
      and(
        eq(schema.sessions.id, payload.sid),
        eq(schema.sessions.tokenHash, tokenHash)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (row.archivedAt) return null;

  // Slide the expiry + touch lastSeen (idempotent, cheap).
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.id, row.sessionId));

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    clinicId: row.clinicId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as Role,
    mfaEnrolled: row.mfaEnrolled,
    mfaVerified: row.mfaVerifiedSession,
    uiMode: row.uiMode as "einfach" | "detail",
    impersonatedByAdminId: row.impersonatedByAdminId,
  };
}

export const getSession = cache(getSessionImpl);

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
 * Revoke every non-expired session for a user. Used after password reset,
 * TOTP re-enrollment, or admin "force-logout".
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

function parseRequestIp(xff: string | null, xri: string | null): string | null {
  const first = (xff ?? xri ?? "").split(",")[0]?.trim();
  return first || null;
}
