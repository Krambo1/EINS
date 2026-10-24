import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {}, schema: {} }));

const { buildLandingConsents, buildMetaConsents, clampConsentTimes, consentTimeOrNow } = await import("./leads");

const NOW = new Date("2026-10-07T18:00:00Z");

describe("consent times (L-6)", () => {
  it("a future landing time becomes the arrival time in every consents.*.at", () => {
    const future = new Date(NOW.getTime() + 60 * 60_000);
    const c = clampConsentTimes(
      buildLandingConsents({ at: future, aiGiven: true, marketingGiven: true }),
      NOW
    )!;
    for (const k of ["privacy", "ageGate", "ai", "marketing"] as const) {
      expect(c[k]!.at).toBe(NOW.toISOString());
    }
    expect(c.basis).toBe("landing_form");
    expect(c.marketing!.pending).toBe("doi");
    expect(consentTimeOrNow(future, NOW).toISOString()).toBe(c.privacy!.at);
  });

  it("a plausible past time stays, one older than 7 days does not", () => {
    const ok = new Date(NOW.getTime() - 2 * 3600_000);
    const old = new Date(NOW.getTime() - 8 * 24 * 3600_000);
    expect(clampConsentTimes(buildMetaConsents({ at: ok, formId: "f" }), NOW)!.privacy!.at).toBe(ok.toISOString());
    expect(clampConsentTimes(buildMetaConsents({ at: old, formId: "f" }), NOW)!.privacy!.at).toBe(NOW.toISOString());
  });

  it("an unparseable time becomes the arrival time; null stays null", () => {
    const c = clampConsentTimes({ basis: "landing_form", privacy: { version: "v9", at: "yesterday" } }, NOW)!;
    expect(c.privacy).toEqual({ version: "v9", at: NOW.toISOString() });
    expect(clampConsentTimes(null, NOW)).toBeNull();
  });
});
