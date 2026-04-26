import "server-only";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/**
 * Cryptographic primitives used by the auth layer and credential store.
 *
 * Design choices:
 *  - Tokens delivered to users (magic-link, session cookie, backup codes) are
 *    URL-safe base64 from 32 random bytes -> 43 chars. We store only their
 *    SHA-256 in the DB so a DB leak doesn't leak usable tokens.
 *  - Platform credentials (Meta / Google refresh tokens) are stored with
 *    AES-256-GCM under ENCRYPTION_KEY, with a random 12-byte IV per value.
 *    Layout: [iv(12) | authTag(16) | ciphertext].
 *  - Backup codes are not hashed with SHA-256 (they're low-entropy) — the
 *    caller should use argon2id via `@node-rs/argon2`. See auth/totp.ts.
 */

/** Generate a URL-safe random token of ~43 chars (32 bytes base64url). */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/** Deterministic SHA-256 hash, hex-encoded. Used for lookup-only tokens. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Constant-time comparison for two equal-length strings. Returns false on mismatch. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return timingSafeEqual(ab, bb);
}

// -----------------------------------------------------------------------------
// AES-256-GCM
// -----------------------------------------------------------------------------

function keyBuffer(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "hex");
}

/**
 * Encrypt a UTF-8 string and return a single Buffer containing
 * [iv(12) | authTag(16) | ciphertext]. Suitable for storing in `bytea`.
 */
export function encryptString(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/** Reverse of `encryptString`. Throws on auth-tag mismatch. */
export function decryptString(blob: Buffer): string {
  if (blob.length < 28) {
    throw new Error("ciphertext too short");
  }
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}
