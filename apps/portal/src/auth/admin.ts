import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../lib/env";
import { generateToken, sha256Hex } from "../lib/crypto";

/**
 * Admin auth — Karam's super-admin identity, entirely SEPARATE from the
 * clinic-user login. The admin panel at /admin/* uses this track.
 *
 * Rules:
 *  - email MUST appear in env.ADMIN_EMAILS (lowercased, trimmed).
 *  - optional IP allowlist (env.ADMIN_IP_ALLOWLIST) — if set, any other
 *    origin IP is rejected.
 *  - MFA is required once enrolled (same TOTP code path as clinic users).
 *  - Magic-link flow reuses the email sender.
 *
 * The two cookies (clinic session vs admin session) use DIFFERENT cookie
 * names and DIFFERENT session tables, so the two contexts cannot overlap.
 */

export const ADMIN_SESSION_COOKIE = "eins_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 4; // 4h — stricter than clinic sessions

const SECRET = new TextEncoder().encode(env.SESSION_SECRET);
const ALG = "HS256";

interface AdminCookiePayload {
  sid: string;
  tok: string;
}

async function signAdminCookie(payload: AdminCookiePayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG, kid: "admin-session-v1" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SECONDS}s`)
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
  mfaEnrolled: boolean;
  mfaVerified: boolean;
}

/** Whitelist check: is this email allowed to access /admin? */
export function isAdminEmail(email: string): boolean {
  return env.ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/** Allowlist check for the requesting IP. Empty list = no restriction. */
export function isAllowedAdminIp(ip: string | null): boolean {
  const list = env.ADMIN_IP_ALLOWLIST;
  if (!list.length) return true;
  if (!ip) return false;
  return list.includes(ip);
}

/**
 * Create an admin session row + cookie. Called from consumeAdminMagicLink()
 * and from the MFA verify action to rotate after step-up.
 */
export async function createAdminSession(
  adminId: string,
  opts: { mfaVerified?: boolean } = {}
): Promise<void> {
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000);

  const hdrs = await headers();
  const ua = hdrs.get("user-agent") ?? null;
  const ip = (hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "").split(",")[0]?.trim() || null;

  const [row] = await db
    .insert(schema.adminSessions)
    .values({
      adminId,
      tokenHash,
      mfaVerified: opts.mfaVerified ?? false,
      userAgent: ua ?? undefined,
      ipAddress: ip ?? undefined,
      expiresAt,
    })
    .returning({ id: schema.adminSessions.id });

  const cookie = await signAdminCookie({ sid: row.id, tok: token });
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });

  await db
    .update(schema.adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.adminUsers.id, adminId));
}

export async function markAdminSessionMfaVerified(sessionId: string): Promise<void> {
  await db
    .update(schema.adminSessions)
    .set({ mfaVerified: true })
    .where(eq(schema.adminSessions.id, sessionId));
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
  const ip = (hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "").split(",")[0]?.trim() || null;
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
      mfaVerifiedSession: schema.adminSessions.mfaVerified,
      expiresAt: schema.adminSessions.expiresAt,
      revokedAt: schema.adminSessions.revokedAt,
      email: schema.adminUsers.email,
      fullName: schema.adminUsers.fullName,
      mfaEnrolled: schema.adminUsers.mfaEnrolled,
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
    mfaEnrolled: row.mfaEnrolled,
    mfaVerified: row.mfaVerifiedSession,
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

/** Ensure an admin_users row exists for the given email (creates one on first use). */
export async function ensureAdminUser(email: string): Promise<{ id: string; mfaEnrolled: boolean }> {
  const lower = email.trim().toLowerCase();
  const existing = await db
    .select({ id: schema.adminUsers.id, mfaEnrolled: schema.adminUsers.mfaEnrolled })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, lower))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(schema.adminUsers)
    .values({ email: lower })
    .returning({ id: schema.adminUsers.id, mfaEnrolled: schema.adminUsers.mfaEnrolled });
  return row;
}
