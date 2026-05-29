import "server-only";
import { randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * Passwort-Hashing + Stärke-Check.
 *
 * Algorithmus: Argon2id mit OWASP-2024-Parametern (19 MiB memory, 2 passes).
 *
 * Stärke-Policy (klassisch streng):
 *   - 12 Zeichen Minimum
 *   - 3 von 4 Zeichenarten: Großbuchstabe, Kleinbuchstabe, Ziffer, Sonderzeichen
 * Gilt identisch für Clinic-User und Admin. Login (Verify) erzwingt die Regeln
 * NICHT, sie greifen nur beim Setzen/Ändern.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const PASSWORD_MIN_CLASSES = 3;

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

/**
 * Validate a candidate password against the policy. Returns ok=true on pass.
 * Caller is responsible for matching German UI strings — the message returned
 * here is already user-facing copy.
 */
export function checkPasswordPolicy(input: unknown): PasswordPolicyResult {
  if (typeof input !== "string") {
    return { ok: false, message: "Ungültige Eingabe." };
  }
  if (input.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Bitte mindestens ${PASSWORD_MIN_LENGTH} Zeichen wählen.`,
    };
  }
  if (input.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: "Passwort ist zu lang." };
  }
  if (countCharacterClasses(input) < PASSWORD_MIN_CLASSES) {
    return {
      ok: false,
      message:
        "Bitte mindestens 3 von 4 Zeichenarten verwenden: Großbuchstabe, Kleinbuchstabe, Ziffer, Sonderzeichen.",
    };
  }
  return { ok: true };
}

/**
 * Zählt, wie viele der vier Klassen (Groß / Klein / Ziffer / Sonderzeichen)
 * im Passwort vorkommen. Umlaute zählen zu Groß/Klein; alles außerhalb von
 * ASCII-Buchstaben + Umlauten + Ziffern gilt als Sonderzeichen (inklusive
 * Leerzeichen und Unicode-Symbolen).
 */
function countCharacterClasses(input: string): number {
  let n = 0;
  if (/[A-ZÄÖÜ]/.test(input)) n++;
  if (/[a-zäöüß]/.test(input)) n++;
  if (/[0-9]/.test(input)) n++;
  if (/[^A-Za-zÄÖÜäöüß0-9]/.test(input)) n++;
  return n;
}

/** Hash a plaintext password. Caller stores the returned string verbatim. */
export async function hashPassword(plaintext: string): Promise<string> {
  return await argon2Hash(plaintext, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

/**
 * Lazily-computed argon2id hash of a per-process random plaintext. Used as a
 * compare-target when verifyPassword is called with no stored hash, so the
 * wall-clock cost matches the "real hash" path. Without this, an attacker can
 * distinguish "user does not exist / has no password" from "user exists, wrong
 * password" by measuring response time (verify-against-DUMMY ≈ 100 ms,
 * shortcut-return ≈ 1 ms). One-time cost on first call per process.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(32).toString("hex"));
  }
  return dummyHashPromise;
}

/**
 * Verify a candidate password against a stored argon2id hash.
 *
 * Returns false on:
 *   - hash is null/empty (user hasn't set a password yet)
 *   - candidate is empty
 *   - argon2 mismatch
 *   - hash is malformed (argon2 throws — we swallow + return false)
 *
 * Critically: even when the stored hash is null/empty OR the candidate is
 * empty, we still execute an argon2Verify against a dummy hash. Skipping the
 * verify on those paths would create a timing oracle for account/credential
 * enumeration.
 */
export async function verifyPassword(
  hash: string | null | undefined,
  candidate: string
): Promise<boolean> {
  const haveHash = Boolean(hash);
  const target = haveHash ? (hash as string) : await getDummyHash();
  const probe = candidate || "__eins_dummy_candidate__";
  try {
    const ok = await argon2Verify(target, probe);
    // ok against the dummy is theoretically possible only for an attacker who
    // guessed the per-process random plaintext (cryptographic impossibility).
    // The haveHash guard is the load-bearing reject.
    return haveHash && Boolean(candidate) && ok;
  } catch {
    return false;
  }
}
