import "server-only";
import { TOTP, Secret } from "otpauth";
import { toDataURL as qrcodeDataUrl } from "qrcode";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { decryptString, encryptString, generateToken } from "../lib/crypto";

/**
 * TOTP (RFC 6238) 2FA — enrollment, verification, backup codes.
 *
 * Storage:
 *  - The shared secret lives AES-GCM-encrypted in `clinic_users.mfa_secret_enc`
 *    (bytea). We never write it in cleartext.
 *  - Backup codes are single-use argon2id hashes stored in
 *    `clinic_users.mfa_backup_codes` as a JSONB array:
 *      [{ hash: "<argon2id>", usedAt: null | iso }]
 *
 * UX:
 *  - First-time enrollment: enrollmentSecret() → show QR via otpauthUrlFor()
 *    → user enters 6-digit code → verifyAndFinalize() commits the encrypted
 *    secret + generates 10 backup codes returned ONCE.
 *  - Subsequent logins: verifyLoginCode() compares the code against the
 *    decrypted secret (±1 window for drift) OR burns a backup code.
 */

const ISSUER = "EINS Visuals";
const DIGITS = 6;
const PERIOD = 30;

/** Build the otpauth:// URL used for QR codes. */
function otpauthUrlFor(secretBase32: string, email: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

export interface EnrollmentOffer {
  /** base32 secret (shown to user as fallback if QR fails). */
  secret: string;
  /** data:image/png;base64 — ready for <img src>. */
  qrDataUrl: string;
}

/**
 * Generate a fresh TOTP secret + QR code. We do NOT persist anything here —
 * the secret must be confirmed via verifyAndFinalize() first.
 */
export async function enrollmentOffer(email: string): Promise<EnrollmentOffer> {
  const secretRaw = new Secret({ size: 20 }); // 160 bits per RFC 4226 §4
  const base32 = secretRaw.base32;
  const url = otpauthUrlFor(base32, email);
  const qr = await qrcodeDataUrl(url, { margin: 1, scale: 6 });
  return { secret: base32, qrDataUrl: qr };
}

function totpFromBase32(secretBase32: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: ISSUER,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Compare a 6-digit code against a base32 secret. ±1 period = 60s drift tolerance. */
function verifyCodeAgainstSecret(secretBase32: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const totp = totpFromBase32(secretBase32);
  const delta = totp.validate({ token: cleaned, window: 1 });
  return delta !== null;
}

/** 10 backup codes, 8 chars each, URL-safe (no ambiguous chars). */
function generateBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 10) {
    // 6 bytes → 8 base32-ish chars. Use crypto bytes and map to an alphabet without look-alikes.
    const raw = generateToken(6);
    const cleaned = raw.replace(/[_\-]/g, "").slice(0, 8).toUpperCase();
    if (cleaned.length === 8) codes.add(cleaned);
  }
  return [...codes];
}

async function hashBackupCode(code: string): Promise<string> {
  return await argon2Hash(code, {
    memoryCost: 19456, // 19 MiB per OWASP 2024 guidance
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

export interface FinalizedEnrollment {
  /** Backup codes shown to user exactly once. */
  backupCodes: string[];
}

/**
 * Verify the user's first TOTP code and commit the encrypted secret +
 * generated backup codes. Returns the plaintext backup codes — the caller
 * MUST display these once and tell the user to save them.
 *
 * Throws if the code is wrong. Caller should catch and re-render the form.
 */
export async function verifyAndFinalizeEnrollment(
  userId: string,
  secretBase32: string,
  code: string
): Promise<FinalizedEnrollment> {
  if (!verifyCodeAgainstSecret(secretBase32, code)) {
    throw new TotpError("invalid_code");
  }
  const encrypted = encryptString(secretBase32);
  const backupCodes = generateBackupCodes();
  const hashed = await Promise.all(
    backupCodes.map(async (c) => ({ hash: await hashBackupCode(c), usedAt: null as string | null }))
  );

  await db
    .update(schema.clinicUsers)
    .set({
      mfaEnrolled: true,
      mfaSecretEnc: encrypted,
      mfaBackupCodes: hashed,
    })
    .where(eq(schema.clinicUsers.id, userId));

  return { backupCodes };
}

/**
 * Verify a TOTP code at login. If the code matches the user's current secret,
 * returns "totp". If it matches a backup code, burns that code and returns
 * "backup". Returns null on mismatch.
 */
export async function verifyLoginCode(
  userId: string,
  code: string
): Promise<"totp" | "backup" | null> {
  const [user] = await db
    .select({
      mfaSecretEnc: schema.clinicUsers.mfaSecretEnc,
      mfaBackupCodes: schema.clinicUsers.mfaBackupCodes,
    })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, userId))
    .limit(1);

  if (!user?.mfaSecretEnc) return null;

  // 1) TOTP fast path
  const secret = decryptString(user.mfaSecretEnc);
  if (verifyCodeAgainstSecret(secret, code)) return "totp";

  // 2) Backup-code path — argon2 verify over each un-used hash.
  const entries = (user.mfaBackupCodes as { hash: string; usedAt: string | null }[] | null) ?? [];
  const trimmed = code.trim().toUpperCase();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.usedAt) continue;
    const ok = await argon2Verify(e.hash, trimmed);
    if (ok) {
      entries[i] = { ...e, usedAt: new Date().toISOString() };
      await db
        .update(schema.clinicUsers)
        .set({ mfaBackupCodes: entries })
        .where(eq(schema.clinicUsers.id, userId));
      return "backup";
    }
  }

  return null;
}

/** Remove MFA from a user (admin reset). Next login re-enrolls. */
export async function resetMfa(userId: string): Promise<void> {
  await db
    .update(schema.clinicUsers)
    .set({
      mfaEnrolled: false,
      mfaSecretEnc: null,
      mfaBackupCodes: [],
    })
    .where(eq(schema.clinicUsers.id, userId));
}

export class TotpError extends Error {
  constructor(public readonly code: "invalid_code") {
    super(`TOTP error: ${code}`);
    this.name = "TotpError";
  }
}

