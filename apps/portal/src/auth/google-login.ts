import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { env, adminOrigin } from "@/lib/env";
import { deriveSigningKey, generateToken } from "@/lib/crypto";
import { hostCookieName } from "@/lib/constants";

/**
 * "Mit Google anmelden" — OAuth 2.0 Authorization Code flow shared by the
 * clinic login (`/api/auth/google/*`) and the admin login
 * (`/admin/login/google/*`).
 *
 * Authenticate-only: we request `openid email profile`, verify the returned
 * id_token, and use the VERIFIED email to match an EXISTING account. We never
 * create accounts and never store a Google identity — the verified email is the
 * whole handshake, exactly like a magic link. Account matching + session
 * minting happen in the two callback routes (clinic → `createSession`,
 * admin → allowlist + `createAdminSession`).
 *
 * CSRF: `/start` signs a short-lived state JWT (`{ track, nonce }`) and stores
 * it in an httpOnly cookie while ALSO passing it as the `state` query param.
 * `/callback` requires cookie === query AND a valid signature, then checks the
 * `track` matches the route. Same double-binding the integrations OAuth uses
 * (see `@/server/oauth`), but with a separate cookie + a track instead of a
 * clinic/user id (there is no session yet at login time).
 */

export type LoginTrack = "clinic" | "admin";

const SECRET = deriveSigningKey("glogin-state-v1");
const STATE_ALG = "HS256";
const STATE_TTL_SECONDS = 600; // 10 min — generous for the Google consent round-trip

export const GOOGLE_LOGIN_STATE_COOKIE = hostCookieName("eins_glogin_state");

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_SCOPE = "openid email profile";

/** Google's signing keys. createRemoteJWKSet caches + rotates them internally. */
const GOOGLE_JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

interface LoginStatePayload {
  track: LoginTrack;
  nonce: string;
}

// ---------------------------------------------------------------------------
// CSRF state
// ---------------------------------------------------------------------------

export async function signLoginState(track: LoginTrack): Promise<string> {
  return await new SignJWT({ track, nonce: generateToken(32) })
    .setProtectedHeader({ alg: STATE_ALG, kid: "glogin-state-v1" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifyLoginState(
  token: string
): Promise<LoginStatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      algorithms: [STATE_ALG],
    });
    if (payload.track !== "clinic" && payload.track !== "admin") return null;
    if (typeof payload.nonce !== "string") return null;
    return { track: payload.track, nonce: payload.nonce };
  } catch {
    return null;
  }
}

export async function setLoginStateCookie(jwt: string): Promise<void> {
  const jar = await cookies();
  jar.set(GOOGLE_LOGIN_STATE_COOKIE, jwt, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax", // must survive the provider bounce back from Google
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
}

export async function readLoginStateCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(GOOGLE_LOGIN_STATE_COOKIE)?.value ?? null;
}

export async function clearLoginStateCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(GOOGLE_LOGIN_STATE_COOKIE);
}

// ---------------------------------------------------------------------------
// Redirect URIs — MUST exactly match a URI registered in the GCP OAuth client,
// and the value used at `/start` must equal the one used at token exchange.
// ---------------------------------------------------------------------------

/** `${APP_ORIGIN}/api/auth/google/callback` — clinic flow, on the clinic host. */
export function googleClinicRedirectUri(): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** `${adminOrigin()}/admin/login/google/callback` — admin flow, on the admin host. */
export function googleAdminRedirectUri(): string {
  return `${adminOrigin()}/admin/login/google/callback`;
}

// ---------------------------------------------------------------------------
// Authorize URL + token exchange
// ---------------------------------------------------------------------------

export function buildGoogleAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: opts.state,
    access_type: "online", // login only — we don't need a refresh token
    prompt: "select_account", // let the user pick which Google account
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
}

/**
 * Exchange an authorization `code` for the user's verified email. Posts to
 * Google's token endpoint, then verifies the returned id_token's signature
 * (Google JWKS), issuer and audience before trusting any claim. Throws if the
 * exchange fails or the token carries no email.
 *
 * `redirectUri` MUST be the same value passed to `buildGoogleAuthorizeUrl` for
 * this flow — Google rejects the exchange otherwise.
 */
export async function exchangeCodeForGoogleEmail(opts: {
  code: string;
  redirectUri: string;
}): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
      code: opts.code,
    }),
  });
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status}`);
  }

  const token = (await res.json()) as { id_token?: string };
  if (!token.id_token) {
    throw new Error("google token exchange returned no id_token");
  }

  // Verify signature + issuer + audience. createRemoteJWKSet only holds RSA
  // keys, so there is no alg-confusion surface to restrict beyond the defaults.
  const { payload } = await jwtVerify(token.id_token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: env.GOOGLE_OAUTH_CLIENT_ID!,
  });

  const email =
    typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) {
    throw new Error("google id_token carried no email claim");
  }
  // On the id_token email_verified is a real boolean; accept the string "true"
  // too (the legacy userinfo endpoint serializes it that way) just in case.
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  return { email, emailVerified };
}
