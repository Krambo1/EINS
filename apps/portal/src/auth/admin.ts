import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull, ne, sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import { deriveSigningKey, generateToken, sha256Hex } from "../lib/crypto";
import { trustedIpFromHeaders } from "../lib/client-ip";
import { hostCookieName } from "../lib/constants";

/**
 * Admin auth — Karam's super-admin identity, entirely SEPARATE from the
 * clinic-user login. The admin panel at /admin/* uses this track.
 *
 * Rules:
 *  - email MUST appear in env.ADMIN_EMAILS (lowercased, trimmed).
 *  - optional IP allowlist (env.ADMIN_IP_ALLOWLIST): if set, any other
 *    origin IP is rejected.
 *  - Password + magic-link login. No TOTP; the admin allowlist + IP gate
 *    are the second factor.
 *
 * The two cookies (clinic session vs admin session) use DIFFERENT cookie
 * names and DIFFERENT session tables, so the two contexts cannot overlap.
 */

export const ADMIN_SESSION_COOKIE = hostCookieName("eins_admin_session");
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 4; // 4h, stricter than clinic sessions
/**
 * "Angemeldet bleiben" für Admins: 7 Tage statt 4 Stunden. Bewusst deutlich
 * kürzer als die 30 Tage auf Clinic-Seite, weil der Admin-Track sicherheits-
 * kritischer ist (kein TOTP; Allowlist + IP-Gate sind der zweite Faktor).
 */
export const ADMIN_SESSION_REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 Tage

const SECRET = deriveSigningKey("admin-session-v1");
const ALG = "HS256";

interface AdminCookiePayload {
  sid: string;
  tok: string;
}

async function signAdminCookie(
  payload: AdminCookiePayload,
  maxAgeSeconds: number
): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG, kid: "admin-session-v1" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(SECRET);
}

async function verifyAdminCookie(token: string): Promise<AdminCookiePayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: [ALG] });
    if (typeof payload.sid !== "string" || typeof payload.tok !== "string") return null;
    return { sid: payload.sid, tok: payload.tok };
  } catch {
    return null;
  }
}

export interface ResolvedAdmin {
  sessionId: string;
  adminId: string;
  email: string;
  fullName: string | null;
}

/** Whitelist check: is this email allowed to access /admin? */
export function isAdminEmail(email: string): boolean {
  return env.ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Allowlist check for the requesting IP.
 *
 * Empty list: allow in non-prod (frictionless dev), but FAIL CLOSED in
 * production — an unset allowlist there silently drops the documented admin
 * second factor (pentest H1 / admin-04). A dynamic-IP operator who cannot
 * maintain an allowlist can consciously opt out with
 * `ADMIN_IP_ALLOWLIST_DISABLED=1`.
 */
export function isAllowedAdminIp(ip: string | null): boolean {
  const list = env.ADMIN_IP_ALLOWLIST;
  if (!list.length) {
    if (env.NODE_ENV === "production") return env.ADMIN_IP_ALLOWLIST_DISABLED;
    return true;
  }
  if (!ip) return false;
  return list.includes(ip);
}

/**
 * Create an admin session row + cookie. Called from consumeAdminMagicLink()
 * and from the password-login action after a successful argon2 verify.
 *
 * @param opts.rememberMe set from the "Angemeldet bleiben"-Häkchen on the admin
 *                        login form; extends the session from 4h to 7 days across
 *                        the JWT, cookie and admin_sessions.expires_at at once.
 */
export async function createAdminSession(
  adminId: string,
  opts: { rememberMe?: boolean } = {}
): Promise<void> {
  const hdrs = await headers();
  const ua = hdrs.get("user-agent") ?? null;
  const ip = trustedIpFromHeaders(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));

  // IP gate at MINT time, not only at read time. Without this a disallowed
  // origin could still create a live admin_sessions row + cookie that
  // "activates" later from an allowlisted IP (pentest authn-02b/03).
  if (!isAllowedAdminIp(ip)) {
    throw new Error(
      "Admin-Anmeldung abgelehnt: IP-Adresse nicht in der Allowlist."
    );
  }

  const maxAgeSeconds = opts.rememberMe
    ? ADMIN_SESSION_REMEMBER_MAX_AGE_SECONDS
    : ADMIN_SESSION_MAX_AGE_SECONDS;
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

  const [row] = await db
    .insert(schema.adminSessions)
    .values({
      adminId,
      tokenHash,
      userAgent: ua ?? undefined,
      ipAddress: ip ?? undefined,
      expiresAt,
    })
    .returning({ id: schema.adminSessions.id });

  const cookie = await signAdminCookie({ sid: row.id, tok: token }, maxAgeSeconds);
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  await db
    .update(schema.adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.adminUsers.id, adminId));
}

/**
 * Resolve the current admin session (if any). Returns null when unauthenticated
 * or when the IP allowlist blocks the request.
 *
 * Wrapped in React.cache below so duplicate calls inside a single render
 * (admin layout + admin page + permission checks) share one DB lookup.
 */
async function getAdminSessionImpl(): Promise<ResolvedAdmin | null> {
  const hdrs = await headers();
  const ip = trustedIpFromHeaders(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));
  if (!isAllowedAdminIp(ip)) return null;

  const jar = await cookies();
  const raw = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!raw) return null;

  const payload = await verifyAdminCookie(raw);
  if (!payload) return null;

  const tokenHash = sha256Hex(payload.tok);
  const rows = await db
    .select({
      sessionId: schema.adminSessions.id,
      adminId: schema.adminSessions.adminId,
      expiresAt: schema.adminSessions.expiresAt,
      revokedAt: schema.adminSessions.revokedAt,
      email: schema.adminUsers.email,
      fullName: schema.adminUsers.fullName,
    })
    .from(schema.adminSessions)
    .innerJoin(schema.adminUsers, eq(schema.adminSessions.adminId, schema.adminUsers.id))
    .where(
      and(
        eq(schema.adminSessions.id, payload.sid),
        eq(schema.adminSessions.tokenHash, tokenHash),
        isNull(schema.adminSessions.revokedAt)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (!isAdminEmail(row.email)) return null;

  return {
    sessionId: row.sessionId,
    adminId: row.adminId,
    email: row.email,
    fullName: row.fullName,
  };
}

export const getAdminSession = cache(getAdminSessionImpl);

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (raw) {
    const payload = await verifyAdminCookie(raw);
    if (payload) {
      await db
        .update(schema.adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.adminSessions.id, payload.sid));
    }
  }
  jar.delete(ADMIN_SESSION_COOKIE);
}

/**
 * Revoke every non-expired admin session for an admin. Used after a password
 * reset / admin "force-logout".
 */
export async function revokeAllAdminSessionsForAdmin(
  adminId: string
): Promise<void> {
  await db
    .update(schema.adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.adminSessions.adminId, adminId),
        isNull(schema.adminSessions.revokedAt),
        dsql`${schema.adminSessions.expiresAt} > now()`
      )
    );
}

/**
 * Revoke every non-expired admin session EXCEPT the one passed in. Used by
 * admin settings password-change flow so the current tab survives.
 */
export async function revokeOtherAdminSessionsForAdmin(
  adminId: string,
  exceptSessionId: string
): Promise<void> {
  await db
    .update(schema.adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.adminSessions.adminId, adminId),
        ne(schema.adminSessions.id, exceptSessionId),
        isNull(schema.adminSessions.revokedAt),
        dsql`${schema.adminSessions.expiresAt} > now()`
      )
    );
}

/** Ensure an admin_users row exists for the given email (creates one on first use). */
export async function ensureAdminUser(email: string): Promise<{ id: string }> {
  const lower = email.trim().toLowerCase();
  const existing = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, lower))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(schema.adminUsers)
    .values({ email: lower })
    .returning({ id: schema.adminUsers.id });
  return row;
}
