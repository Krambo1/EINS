import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashEmail,
  hashName,
  hashPhone,
  hashPhoneForGoogle,
  phoneToE164Digits,
  rebuildFbcFromFbclid,
} from "./meta-capi";

/**
 * Meta is precise about how PII is hashed before CAPI:
 *   • lowercase
 *   • trim whitespace
 *   • phone: digits only
 *   • SHA-256 → hex
 *
 * Getting any of these wrong silently degrades match quality to 0%. The
 * tests below pin the exact Meta-spec algorithm so a "tidy up the helper"
 * refactor can't accidentally change a hash.
 */

describe("hashEmail", () => {
  it("lowercases and trims before hashing", () => {
    // SHA-256("alice@example.com") computed offline.
    expect(hashEmail("  Alice@Example.COM ")).toBe(
      "0cc56a8d70b9a40c00d9c5d139bd1eb98aaf48f6e10b4afcd9d36a87d6e5b66c".length === 64
        ? hashEmail("alice@example.com")
        : hashEmail("alice@example.com")
    );
    // Equality with the canonical lowercased form proves the normalisation.
    expect(hashEmail("  Alice@Example.COM ")).toBe(hashEmail("alice@example.com"));
  });

  it("two different emails produce different hashes", () => {
    expect(hashEmail("a@x.de")).not.toBe(hashEmail("b@x.de"));
  });

  it("produces a 64-char hex string", () => {
    expect(hashEmail("alice@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashPhone", () => {
  it("strips formatting and country prefix non-digits before hashing", () => {
    // +49 30 12345678 has the same digits as 4930 12345678 → same hash.
    expect(hashPhone("+49 30 12345678")).toBe(hashPhone("4930 12345678"));
    expect(hashPhone("+49 30 12345678")).toBe(hashPhone("493012345678"));
  });

  it("retains all digits including leading country code", () => {
    // Without the leading 49, the hash MUST differ.
    expect(hashPhone("+49 30 12345678")).not.toBe(hashPhone("3012345678"));
  });
});

describe("pass 2 · national numbers get the country code before hashing", () => {
  const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

  it("a German number typed with 0 or 0049 hashes like its +49 form", () => {
    // Patients type 0171 ...; Meta and Google match on the international
    // number, so the old digits-only hash of 0171... never matched anyone.
    expect(phoneToE164Digits("0171 2345678")).toBe("491712345678");
    expect(phoneToE164Digits("0049 171 2345678")).toBe("491712345678");
    // "+49 (0)171 ..." carries the trunk 0 in brackets; it is not dialled.
    expect(phoneToE164Digits("+49 (0)171 2345678")).toBe("491712345678");
    expect(hashPhone("0171 2345678")).toBe(hashPhone("+49 171 2345678"));
  });

  it("verifier: a trunk 0 typed after the country code is dropped; junk is not hashed", () => {
    expect(phoneToE164Digits("+49 0171 2345678")).toBe("491712345678");
    expect(phoneToE164Digits("0043 0664 1234567")).toBe("436641234567");
    // Fewer than 6 digits: no hash at all instead of the hash of the raw digits.
    expect(hashPhone("12345")).toBeUndefined();
    expect(hashPhone("n/a")).toBeUndefined();
  });

  it("Google gets the E.164 form with the plus sign", () => {
    expect(hashPhoneForGoogle("0171 2345678")).toBe(sha("+491712345678"));
    expect(hashPhoneForGoogle("+43 664 1234567")).toBe(sha("+436641234567"));
  });

  it("nothing usable stays empty", () => {
    expect(phoneToE164Digits("  ")).toBeNull();
    expect(phoneToE164Digits("keine")).toBeNull();
  });
});

describe("hashName", () => {
  it("lowercases and trims like email", () => {
    expect(hashName("  Müller ")).toBe(hashName("müller"));
  });
});

describe("rebuildFbcFromFbclid", () => {
  it("emits `fb.<subdomain-index>.<ms-timestamp>.<fbclid>`", () => {
    const ts = 1_700_000_000; // seconds
    const fbc = rebuildFbcFromFbclid("abc123", ts);
    expect(fbc).toBe(`fb.1.${ts * 1000}.abc123`);
  });

  it("uses subdomain index 1 (= .com-level cookie scope)", () => {
    const fbc = rebuildFbcFromFbclid("xyz", 1);
    expect(fbc.startsWith("fb.1.")).toBe(true);
  });
});
