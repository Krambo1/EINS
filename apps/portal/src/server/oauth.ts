import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

/**
 * OAuth CSRF-state helpers shared by /api/integrations/{meta,google}.
 *
 * State flow:
 *   1. `/start` signs a short-lived JWT carrying {clinicId, userId, platform}
 *      and stores it in a same-site, httpOnly cookie. We also pass the JWT
 *      as the `state` query parameter to the provider.
 *   2. Provider bounces to `/callback?code=...&state=<jwt>`.
 *   3. `/callback` verifies the JWT, cross-checks the cookie value, then
 *      proceeds to the token exchange.
 *
 * The double-binding (cookie + query) makes CSRF impractical even if one
 * side is leaked.
 */

const SECRET = new TextEncoder().encode(env.SESSION_SECRET);
const STATE_TTL_SECONDS = 600; // 10 min — user shouldn't take longer

export const OAUTH_STATE_COOKIE = "eins_oauth_state";

export interface OAuthState {
  clinicId: string;
  userId: string;
  platform: "meta" | "google";
  /** Random nonce — binds JWT to cookie. */
  nonce: string;
}

export async function signState(payload: OAuthState): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", kid: "oauth-state-v1" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifyState(token: string): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if (
      typeof payload.clinicId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.platform !== "string" ||
      typeof payload.nonce !== "string"
    ) {
      return null;
    }
    if (payload.platform !== "meta" && payload.platform !== "google") {
      return null;
    }
    return {
      clinicId: payload.clinicId,
      userId: payload.userId,
      platform: payload.platform,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

/** Set the state cookie. Callers SHOULD also pass the same JWT via `state` query. */
export async function setStateCookie(jwt: string): Promise<void> {
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, jwt, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax", // must be lax so the provider bounce retains it
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
}

export async function clearStateCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(OAUTH_STATE_COOKIE);
}

export async function readStateCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(OAUTH_STATE_COOKIE)?.value ?? null;
}
