import { describe, expect, it } from "vitest";
import { makeRateLimiter } from "./log-throttle.js";

describe("makeRateLimiter", () => {
  it("fires on the first call", () => {
    const gate = makeRateLimiter(10_000);
    expect(gate(0)).toBe(true);
  });

  it("suppresses within the interval and re-fires after it", () => {
    const gate = makeRateLimiter(10 * 60_000); // 10 min
    const t0 = 1_000_000;
    expect(gate(t0)).toBe(true); // first
    expect(gate(t0 + 60_000)).toBe(false); // +1 min, suppressed
    expect(gate(t0 + 9 * 60_000)).toBe(false); // +9 min, still suppressed
    expect(gate(t0 + 10 * 60_000)).toBe(true); // +10 min, boundary re-fires
    expect(gate(t0 + 10 * 60_000 + 1)).toBe(false); // immediately after, suppressed
  });

  it("keeps independent state per instance", () => {
    const a = makeRateLimiter(1000);
    const b = makeRateLimiter(1000);
    expect(a(0)).toBe(true);
    expect(b(0)).toBe(true); // b is not affected by a
    expect(a(500)).toBe(false);
    expect(b(1000)).toBe(true);
  });
});
