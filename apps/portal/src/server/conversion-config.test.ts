import { describe, expect, it } from "vitest";
import {
  metaCapiTokenEnvName,
  normalizeGoogleCustomerId,
} from "./conversion-config";

describe("metaCapiTokenEnvName", () => {
  it("uppercases the slug and replaces dashes with underscores", () => {
    // Matches the exact convention used by clinic-landing's envTokenForSlug.
    // Drift here would break the assumption that "Lead works → Purchase works".
    expect(metaCapiTokenEnvName("praxis-mueller-muenchen")).toBe(
      "META_CAPI_TOKEN_PRAXIS_MUELLER_MUENCHEN"
    );
  });

  it("handles all-numeric or single-segment slugs", () => {
    expect(metaCapiTokenEnvName("test1")).toBe("META_CAPI_TOKEN_TEST1");
  });
});

describe("normalizeGoogleCustomerId", () => {
  it("strips dashes from 123-456-7890 → 1234567890", () => {
    expect(normalizeGoogleCustomerId("123-456-7890")).toBe("1234567890");
  });

  it("returns the input unchanged when it's already digits-only", () => {
    expect(normalizeGoogleCustomerId("1234567890")).toBe("1234567890");
  });

  it("returns null for empty/null inputs", () => {
    expect(normalizeGoogleCustomerId(null)).toBeNull();
    expect(normalizeGoogleCustomerId("")).toBeNull();
    expect(normalizeGoogleCustomerId(undefined)).toBeNull();
  });

  it("returns null when fewer than 10 digits remain after stripping", () => {
    // Google Ads customer IDs are always 10 digits. A short input is a typo.
    expect(normalizeGoogleCustomerId("12-34")).toBeNull();
    expect(normalizeGoogleCustomerId("123456789")).toBeNull();
  });
});
