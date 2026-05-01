import "server-only";
import { TOTP, Secret } from "otpauth";
import { toDataURL as qrcodeDataUrl } from "qrcode";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { decryptString, encryptString } from "../lib/crypto";

/**
 * TOTP for the separate admin identity. Same RFC 6238 parameters as the
 * clinic-user flow, but simpler: no backup codes (admin can reset via DB or
 * via the CLI script scripts/reset-admin-mfa.ts if needed).
 */

const ISSUER = "EINS Visuals Admin";
const DIGITS = 6;
const PERIOD = 30;

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

function verifyCodeAgainstSecret(secretBase32: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const totp = totpFromBase32(secretBase32);
  const delta = totp.validate({ token: cleaned, window: 1 });
  return delta !== null;
}

export interface AdminEnrollmentOffer {
  secret: string;
  qrDataUrl: string;
}

export async function adminEnrollmentOffer(
  email: string
): Promise<AdminEnrollmentOffer> {
  const secretRaw = new Secret({ size: 20 });
  const base32 = secretRaw.base32;
  const url = otpauthUrlFor(base32, email);
  const qr = await qrcodeDataUrl(url, { margin: 1, scale: 6 });
  return { secret: base32, qrDataUrl: qr };
}

/**
 * Commit the encrypted secret after the admin proves they scanned the QR
 * by entering a valid code. Throws on mismatch.
 */
export async function verifyAndFinalizeAdminEnrollment(
  adminId: string,
  secretBase32: string,
  code: string
): Promise<void> {
  if (!verifyCodeAgainstSecret(secretBase32, code)) {
    throw new Error("invalid_code");
  }
  const encrypted = encryptString(secretBase32);
  await db
    .update(schema.adminUsers)
    .set({ mfaEnrolled: true, mfaSecretEnc: encrypted })
    .where(eq(schema.adminUsers.id, adminId));
}

export async function verifyAdminLoginCode(
  adminId: string,
  code: string
): Promise<boolean> {
  const [row] = await db
    .select({ mfaSecretEnc: schema.adminUsers.mfaSecretEnc })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, adminId))
    .limit(1);
  if (!row?.mfaSecretEnc) return false;
  const secret = decryptString(row.mfaSecretEnc);
  return verifyCodeAgainstSecret(secret, code);
}
