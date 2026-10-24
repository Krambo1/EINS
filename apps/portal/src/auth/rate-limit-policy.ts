/**
 * Rate-limit buckets for the auth flows (B-5). Pure: scopes, limits and key
 * normalisation only; server/rate-limit.ts does the counting.
 *
 * Before: password attempts, magic-link and reset requests all shared one
 * `login:email` bucket (10/h, successes counted too). Ten requests with a
 * known Inhaber address locked her out of password login AND every recovery
 * path for an hour, and a Praxis behind one NAT shared 30 attempts per hour.
 *
 * Now:
 *   - password buckets count FAILED attempts only: a slot is reserved
 *     atomically before the Argon2 verify (server/rate-limit-slot.ts) and
 *     given back on success. A Praxis team logging in successfully behind one
 *     IP never fills them, and a parallel burst cannot overshoot the limit.
 *   - link requests (magic link + reset) have their own buckets per address
 *     and per IP, so a password lockout never blocks recovery.
 *   - the password-change form has its own per-user failure bucket (B-16).
 */

export interface BucketPolicy {
  scope: string;
  limit: number;
  windowSeconds: number;
}

export const AUTH_BUCKETS = {
  /** Failed password logins per address. */
  passwordFailByEmail: { scope: "login:pw-fail:email", limit: 10, windowSeconds: 60 * 60 },
  /** Failed password logins per client IP (spraying across addresses). */
  passwordFailByIp: { scope: "login:pw-fail:ip", limit: 30, windowSeconds: 60 * 60 },
  /** Login / reset link requests per address: short burst window. */
  linkByEmailBurst: { scope: "login:link:email:10m", limit: 3, windowSeconds: 10 * 60 },
  /** Login / reset link requests per address: hourly cap (mail flooding). */
  linkByEmailHour: { scope: "login:link:email:1h", limit: 10, windowSeconds: 60 * 60 },
  /** Login / reset link requests per client IP. */
  linkByIp: { scope: "login:link:ip", limit: 30, windowSeconds: 60 * 60 },
  /** Wrong "aktuelles Passwort" on /einstellungen/sicherheit per user. */
  passwordChangeFailByUser: { scope: "pw-change:fail:user", limit: 10, windowSeconds: 60 * 60 },
} as const satisfies Record<string, BucketPolicy>;

/** Admin track: same split, separate scopes so the two never interfere. */
export const ADMIN_AUTH_BUCKETS = {
  passwordFailByEmail: { scope: "admin-login:pw-fail:email", limit: 10, windowSeconds: 60 * 60 },
  passwordFailByIp: { scope: "admin-login:pw-fail:ip", limit: 30, windowSeconds: 60 * 60 },
  linkByEmailBurst: { scope: "admin-login:link:email:10m", limit: 3, windowSeconds: 10 * 60 },
  linkByEmailHour: { scope: "admin-login:link:email:1h", limit: 10, windowSeconds: 60 * 60 },
  linkByIp: { scope: "admin-login:link:ip", limit: 30, windowSeconds: 60 * 60 },
} as const satisfies Record<string, BucketPolicy>;

/** Email identifier for bucket keys: trimmed + lowercased (citext semantics). */
export function emailBucketId(email: string): string {
  return email.trim().toLowerCase();
}

/** IP identifier for bucket keys; requests without a trusted IP share "unknown". */
export function ipBucketId(ip: string | null | undefined): string {
  const v = (ip ?? "").trim().toLowerCase();
  return v.length > 0 ? v : "unknown";
}

/** Full key as stored in rate_limits.key (must match server/rate-limit.ts). */
export function rateLimitKey(scope: string, identifier: string): string {
  return `rl:${scope}:${identifier}`;
}
