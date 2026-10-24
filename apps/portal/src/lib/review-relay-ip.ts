import { createHmac, timingSafeEqual } from "node:crypto";
import { trustedIpFromHeaders } from "./client-ip";
import { env } from "./env";

/**
 * J-8: patient IP relayed by clinic-landing for the review-token rate limits.
 *
 * The patient opens `<landing>/r/<token>`; the landing SERVER calls
 * `/api/review-tokens/<token>…`. Without this, every patient shares the
 * landing function's egress IP in the portal's rate-limit key.
 *
 * Wire format (same HMAC-SHA256 `sha256=<hex>` style as the intake relay,
 * but one shared secret `REVIEW_RELAY_SECRET` in both apps, because the
 * landing does not know the token's Praxis before asking the portal):
 *
 *   X-EINS-Client-IP:            <patient ip>
 *   X-EINS-Client-IP-Ts:         <unix seconds>
 *   X-EINS-Client-IP-Signature:  sha256=HMAC(secret, "review-ip:v1\n<token>\n<ip>\n<ts>")
 *
 * Bound to the token and valid for 5 minutes. The header is trusted ONLY
 * when the signature matches; otherwise the caller's own IP is used, which
 * is the old behaviour (a missing secret changes nothing).
 * Mirror: apps/clinic-landing/lib/portal-review-tokens.ts.
 */

export const RELAY_IP_HEADER = "x-eins-client-ip";
export const RELAY_TS_HEADER = "x-eins-client-ip-ts";
export const RELAY_SIG_HEADER = "x-eins-client-ip-signature";
const MAX_SKEW_SECONDS = 300;

export function relayIpMessage(token: string, ip: string, ts: string): string {
  return `review-ip:v1\n${token}\n${ip}\n${ts}`;
}

/** The relayed IP when the signature is valid and fresh, else null. */
export function verifyRelayedIp(
  headers: Headers,
  token: string,
  secret: string | undefined,
  nowMs: number = Date.now()
): string | null {
  if (!secret) return null;
  const ip = headers.get(RELAY_IP_HEADER)?.trim();
  const ts = headers.get(RELAY_TS_HEADER)?.trim();
  const sig = headers.get(RELAY_SIG_HEADER)?.trim();
  if (!ip || !ts || !sig) return null;
  if (ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  if (!/^\d{1,12}$/.test(ts)) return null;
  if (Math.abs(nowMs / 1000 - Number(ts)) > MAX_SKEW_SECONDS) return null;
  const m = sig.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return null;
  const provided = Buffer.from(m[1]!, "hex");
  const expected = createHmac("sha256", secret).update(relayIpMessage(token, ip, ts)).digest();
  return timingSafeEqual(expected, provided) ? ip : null;
}

/** Rate-limit key for the review-token routes: signed patient IP, else caller IP. */
export function reviewRateLimitIp(request: Request, token: string): string {
  return (
    verifyRelayedIp(request.headers, token, env.REVIEW_RELAY_SECRET) ??
    trustedIpFromHeaders(
      request.headers.get("x-forwarded-for"),
      request.headers.get("x-real-ip")
    ) ??
    "anon"
  );
}
