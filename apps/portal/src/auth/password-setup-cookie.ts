import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../lib/env";

/**
 * Kurzlebige Hand-Off-Cookie für den Set-/Reset-Password-Flow.
 *
 * Problem ohne diesen Layer: Der Magic-Link-Token landet beim Klick im URL
 * (`/set-password?token=…`) und bleibt dort während die Form gerendert wird.
 * Browser-History, Server-Access-Logs und der Referer-Header bei externen
 * Resources (z.B. ein Bild aus einem fremden CDN) leaken den Token alle.
 *
 * Lösung: Der Callback konsumiert den Magic-Link sofort und gibt stattdessen
 * eine httpOnly-Cookie raus, die 10 Minuten gültig ist. Die Form liest sie
 * serverseitig, der Submit konsumiert die Cookie atomar.
 *
 * Trade-off: Wenn der User den Link klickt aber die Form nicht abschickt, ist
 * der Magic-Link verbrannt (10 min Cookie-TTL statt 15 min URL-Token-TTL).
 * Akzeptabel — ein neuer "Passwort vergessen"-Klick produziert sofort einen
 * neuen Link.
 *
 * Cookies sind pro Track getrennt (clinic vs admin), damit Karam in einem
 * Browser-Profil gleichzeitig einen Clinic-Reset und einen Admin-Reset
 * laufen lassen kann ohne Kollision.
 */

export const PWD_SETUP_COOKIE_CLINIC = "eins_pwd_setup";
export const PWD_SETUP_COOKIE_ADMIN = "eins_admin_pwd_setup";
export const PWD_SETUP_TTL_SECONDS = 10 * 60;

const SECRET = new TextEncoder().encode(env.SESSION_SECRET);
const ALG = "HS256";

export type PasswordSetupKind = "clinic" | "admin";
export type PasswordSetupIntent = "set_password" | "reset_password";

export interface PasswordSetupPayload {
  kind: PasswordSetupKind;
  userId: string;
  intent: PasswordSetupIntent;
}

function cookieNameFor(kind: PasswordSetupKind): string {
  return kind === "clinic" ? PWD_SETUP_COOKIE_CLINIC : PWD_SETUP_COOKIE_ADMIN;
}

/**
 * Set the password-setup cookie. Caller is responsible for ensuring the
 * userId is valid for the kind (clinic_users.id vs admin_users.id).
 */
export async function issuePasswordSetupCookie(
  kind: PasswordSetupKind,
  userId: string,
  intent: PasswordSetupIntent
): Promise<void> {
  const token = await new SignJWT({ k: kind, uid: userId, intent })
    .setProtectedHeader({ alg: ALG, kid: "pwd-setup-v1" })
    .setIssuedAt()
    .setExpirationTime(`${PWD_SETUP_TTL_SECONDS}s`)
    .sign(SECRET);

  const jar = await cookies();
  jar.set(cookieNameFor(kind), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: PWD_SETUP_TTL_SECONDS,
  });
}

/**
 * Read + verify the cookie for `kind`. Returns null on missing/invalid/expired.
 * Does NOT clear the cookie — caller decides when to clear (typically on
 * successful password write).
 */
export async function readPasswordSetupCookie(
  kind: PasswordSetupKind
): Promise<PasswordSetupPayload | null> {
  const jar = await cookies();
  const raw = jar.get(cookieNameFor(kind))?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, SECRET, { algorithms: [ALG] });
    if (
      payload.k !== kind ||
      typeof payload.uid !== "string" ||
      (payload.intent !== "set_password" && payload.intent !== "reset_password")
    ) {
      return null;
    }
    return {
      kind,
      userId: payload.uid,
      intent: payload.intent,
    };
  } catch {
    return null;
  }
}

/** Delete the cookie. Called after a successful password write. */
export async function clearPasswordSetupCookie(
  kind: PasswordSetupKind
): Promise<void> {
  const jar = await cookies();
  jar.delete(cookieNameFor(kind));
}
