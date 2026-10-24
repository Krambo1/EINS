import { describe, expect, it } from "vitest";
import {
  isAllowedGoogleReviewUrl,
  isAllowedJamedaUrl,
  normalizeAllowedLandingOrigin,
} from "./review-url-allowlist";

describe("isAllowedGoogleReviewUrl", () => {
  it.each([
    "https://search.google.com/local/writereview?placeid=ChIJ123",
    "https://g.page/r/CabcDEF/review",
    "https://maps.app.goo.gl/AbCd123",
    "https://www.google.com/maps/place/Praxis",
  ])("accepts %s", (u) => expect(isAllowedGoogleReviewUrl(u)).toBe(true));

  it.each([
    "http://g.page/r/CabcDEF/review",
    "https://sites.google.com/view/phish",
    "https://docs.google.com/forms/d/x",
    "https://script.google.com/macros/s/x/exec",
    "https://www.google.com/search?q=praxis",
    "https://search.google.com/search?q=x",
    "https://g.page.evil.example/r/x",
    "javascript:alert(1)",
    "kein link",
  ])("rejects %s", (u) => expect(isAllowedGoogleReviewUrl(u)).toBe(false));

  // V3 Neben 5: /maps and /local only as whole path segments, no encoded
  // separators or dot steps that could leave the section.
  it.each([
    "https://www.google.com/maps",
    "https://www.google.com/maps/",
    "https://google.com/maps/place/Praxis",
    "https://www.google.com/maps/place/Praxis+Dr.+A+%2F+Dr.+B/@51.2,6.7,17z",
    "https://www.google.com/maps/place/Praxis+f%C3%BCr+%C3%A4sthetische+Medizin",
    "https://www.google.com/maps/place/...+Praxis",
    "https://search.google.com/local/",
    "https://search.google.com/local/reviews?placeid=ChIJ123",
  ])("accepts whole-segment path %s", (u) => expect(isAllowedGoogleReviewUrl(u)).toBe(true));

  it.each([
    "https://www.google.com/mapsx",
    "https://www.google.com/maps-evil/x",
    "https://www.google.com/maps%2f..%2furl?q=https://evil.example",
    "https://www.google.com/maps%2F..%2Furl?q=https://evil.example",
    "https://www.google.com/maps%5c..%5curl",
    "https://www.google.com/maps/%2e%2e/url?q=https://evil.example",
    "https://www.google.com/maps/.%2E/url",
    "https://www.google.com/maps/x%2f..%2f..%2furl",
    "https://www.google.com/maps/x%2F%2E%2E%2F%2E%2E%2Furl",
    "https://www.google.com/maps/%252e%252e/url",
    "https://www.google.com/maps/x%252f..%252f..%252furl",
    "https://www.google.com/maps/%E0%A4%A",
    "https://www.google.com/url?q=https://evil.example",
    "https://search.google.com/local",
    "https://search.google.com/localx/reviews",
    "https://search.google.com/local%2f..%2fsearch",
    "https://search.google.com/local/x%2f..%2f..%2fsearch",
  ])("rejects %s", (u) => expect(isAllowedGoogleReviewUrl(u)).toBe(false));
});

describe("isAllowedJamedaUrl", () => {
  it("accepts https jameda hosts only", () => {
    expect(isAllowedJamedaUrl("https://www.jameda.de/dr-x/bewerten/")).toBe(true);
    expect(isAllowedJamedaUrl("http://www.jameda.de/x")).toBe(false);
    expect(isAllowedJamedaUrl("https://jameda.de.evil.example/x")).toBe(false);
  });
});

describe("normalizeAllowedLandingOrigin", () => {
  const def = "https://praxis.eins.ag";
  it("accepts the default origin and strips the path", () => {
    expect(normalizeAllowedLandingOrigin("https://praxis.eins.ag/r/x", def, undefined)).toBe(
      "https://praxis.eins.ag"
    );
  });
  it("accepts listed extra origins", () => {
    expect(
      normalizeAllowedLandingOrigin("https://www.dr-x.de", def, " https://www.dr-x.de , https://y.de")
    ).toBe("https://www.dr-x.de");
  });
  it("rejects anything else", () => {
    expect(normalizeAllowedLandingOrigin("https://evil.example", def, undefined)).toBeNull();
    expect(normalizeAllowedLandingOrigin("http://praxis.eins.ag", def, undefined)).toBeNull();
    expect(normalizeAllowedLandingOrigin("https://praxis.eins.ag.evil.example", def, "")).toBeNull();
  });
  it("allows the http localhost default in dev", () => {
    expect(
      normalizeAllowedLandingOrigin("http://localhost:3002", "http://localhost:3002", undefined)
    ).toBe("http://localhost:3002");
  });
});
