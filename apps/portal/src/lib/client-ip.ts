import "server-only";
import { headers } from "next/headers";

/**
 * Trusted client-IP resolution, shared by every auth / rate-limit / audit
 * call site.
 *
 * Why not `x-forwarded-for.split(",")[0]`? The LEFTMOST XFF entry is
 * attacker-supplied: any client can send `X-Forwarded-For: 1.2.3.4` and a
 * leftmost parse happily reports 1.2.3.4 — which defeats the admin IP
 * allowlist and lets a flooder rotate rate-limit keys for free.
 *
 * Trust order:
 *   1. `x-real-ip` — on Vercel (our edge) this is set by the platform itself
 *      and inbound values are overwritten, so it cannot be spoofed.
 *   2. The RIGHTMOST `x-forwarded-for` entry — appended by the last (trusted)
 *      proxy hop, unlike the leftmost which the client controls.
 *   3. null (local dev with no proxy in front).
 */
export function trustedIpFromHeaders(
  xff: string | null,
  xri: string | null
): string | null {
  const real = xri?.trim();
  if (real) return real;
  if (!xff) return null;
  const hops = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return hops.length ? hops[hops.length - 1]! : null;
}

/** Resolve the trusted client IP from the current request's headers. */
export async function getTrustedClientIp(): Promise<string | null> {
  const hdrs = await headers();
  return trustedIpFromHeaders(
    hdrs.get("x-forwarded-for"),
    hdrs.get("x-real-ip")
  );
}
