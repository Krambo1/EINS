import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "./request-origin";

const h = (init: Record<string, string>) => new Headers(init);

describe("isCrossSiteRequest (B-15)", () => {
  it("trusts Sec-Fetch-Site when present", () => {
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "cross-site" }))).toBe(true);
    // a sibling subdomain is not our origin either
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("Sec-Fetch-Site wins over a matching Origin", () => {
    expect(
      isCrossSiteRequest(
        h({ "sec-fetch-site": "cross-site", origin: "https://portal.eins.ag", host: "portal.eins.ag" })
      )
    ).toBe(true);
  });

  it("falls back to Origin vs Host", () => {
    expect(isCrossSiteRequest(h({ origin: "https://portal.eins.ag", host: "portal.eins.ag" }))).toBe(false);
    expect(isCrossSiteRequest(h({ origin: "https://evil.example", host: "portal.eins.ag" }))).toBe(true);
    expect(
      isCrossSiteRequest(
        h({ origin: "https://portal.eins.ag", "x-forwarded-host": "portal.eins.ag", host: "internal:3000" })
      )
    ).toBe(false);
  });

  it("treats an opaque or unparsable Origin as cross-site", () => {
    expect(isCrossSiteRequest(h({ origin: "null", host: "portal.eins.ag" }))).toBe(true);
    expect(isCrossSiteRequest(h({ origin: "::::", host: "portal.eins.ag" }))).toBe(true);
  });

  it("treats a request without either header as not cross-site (SameSite=Lax covers it)", () => {
    expect(isCrossSiteRequest(h({}))).toBe(false);
  });
});
