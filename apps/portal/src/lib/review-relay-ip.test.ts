import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { relayIpMessage, reviewRateLimitIp, verifyRelayedIp } from "./review-relay-ip";

const TOKEN = "a".repeat(64);
const SECRET = "test-relay-secret";
const NOW = 1_800_000_000_000;

/** Same construction as apps/clinic-landing/lib/portal-review-tokens.ts relayIpHeaders. */
function signed(ip: string, tsSec: number, token = TOKEN, secret = SECRET): Headers {
  const ts = String(tsSec);
  const mac = createHmac("sha256", secret).update(`review-ip:v1\n${token}\n${ip}\n${ts}`).digest("hex");
  return new Headers({
    "X-EINS-Client-IP": ip,
    "X-EINS-Client-IP-Ts": ts,
    "X-EINS-Client-IP-Signature": `sha256=${mac}`,
  });
}

describe("verifyRelayedIp", () => {
  it("message format matches the landing signer", () => {
    expect(relayIpMessage(TOKEN, "1.2.3.4", "5")).toBe(`review-ip:v1\n${TOKEN}\n1.2.3.4\n5`);
  });
  it("accepts a fresh, correctly signed IP", () => {
    expect(verifyRelayedIp(signed("203.0.113.7", NOW / 1000), TOKEN, SECRET, NOW)).toBe("203.0.113.7");
    expect(verifyRelayedIp(signed("2001:db8::1", NOW / 1000), TOKEN, SECRET, NOW)).toBe("2001:db8::1");
  });
  it("rejects without secret, wrong secret, other token, stale ts, tampered ip", () => {
    const h = signed("203.0.113.7", NOW / 1000);
    expect(verifyRelayedIp(h, TOKEN, undefined, NOW)).toBeNull();
    expect(verifyRelayedIp(h, TOKEN, "other", NOW)).toBeNull();
    expect(verifyRelayedIp(h, "b".repeat(64), SECRET, NOW)).toBeNull();
    expect(verifyRelayedIp(signed("203.0.113.7", NOW / 1000 - 301), TOKEN, SECRET, NOW)).toBeNull();
    h.set("X-EINS-Client-IP", "198.51.100.1");
    expect(verifyRelayedIp(h, TOKEN, SECRET, NOW)).toBeNull();
  });
  it("unsigned header is ignored by the rate-limit key", () => {
    const req = new Request("https://portal.test/api/review-tokens/x", {
      headers: { "X-EINS-Client-IP": "9.9.9.9", "x-real-ip": "10.0.0.1" },
    });
    expect(reviewRateLimitIp(req, TOKEN)).toBe("10.0.0.1");
  });
});
