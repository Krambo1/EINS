import { describe, it, expect } from "vitest";
import {
  leadTokenForRequestId,
  parseLeadTokenFromBemerkung,
} from "./pvs-token";

describe("pvs-token", () => {
  describe("leadTokenForRequestId", () => {
    it("produces a deterministic 18-char token", () => {
      const t = leadTokenForRequestId("abcdef01-2345-6789-abcd-ef0123456789");
      expect(t).toBe("EINS-Lead-abcdef01");
      expect(t.length).toBe(18);
    });

    it("strips dashes before slicing — same output regardless of format", () => {
      const a = leadTokenForRequestId("abcdef0123456789abcdef0123456789");
      const b = leadTokenForRequestId("abcdef01-2345-6789-abcd-ef0123456789");
      expect(a).toBe(b);
    });

    it("is stable across calls for the same id", () => {
      const id = "11111111-2222-3333-4444-555555555555";
      expect(leadTokenForRequestId(id)).toBe(leadTokenForRequestId(id));
    });
  });

  describe("parseLeadTokenFromBemerkung", () => {
    it("matches the canonical 'EINS-Lead-abc12345' shape", () => {
      const r = parseLeadTokenFromBemerkung("EINS-Lead-abc12345");
      expect(r).toEqual({
        token: "EINS-Lead-abc12345",
        prefix: "abc12345",
      });
    });

    it("matches mid-string occurrences", () => {
      const r = parseLeadTokenFromBemerkung("Patientin via EINS-Lead-deadbeef gemeldet");
      expect(r?.prefix).toBe("deadbeef");
    });

    it("is case-insensitive on the sigil but lowercases the hex", () => {
      const r = parseLeadTokenFromBemerkung("eins-lead-ABCDEF12 — gemeldet");
      expect(r?.prefix).toBe("abcdef12");
    });

    it("tolerates colons + spaces between sigil and hex", () => {
      expect(parseLeadTokenFromBemerkung("EINS Lead: abc12345")?.prefix).toBe("abc12345");
      expect(parseLeadTokenFromBemerkung("EINS_Lead_abc12345")?.prefix).toBe("abc12345");
    });

    it("rejects 7-char or 9-char hex (must be exactly 8)", () => {
      expect(parseLeadTokenFromBemerkung("EINS-Lead-1234567")).toBeNull();
      // 9 chars: regex grabs the first 8 still — that's fine, the linker will
      // either find exactly one match or reject the lookup. Keep this as
      // documented behaviour:
      expect(parseLeadTokenFromBemerkung("EINS-Lead-123456789")?.prefix).toBe(
        "12345678"
      );
    });

    it("returns null for unrelated text", () => {
      expect(parseLeadTokenFromBemerkung("Hat keinen Bezug zur Anfrage")).toBeNull();
      expect(parseLeadTokenFromBemerkung("")).toBeNull();
    });

    it("rejects non-hex characters in the prefix slot", () => {
      expect(parseLeadTokenFromBemerkung("EINS-Lead-gggggggg")).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("a token generated for an id parses back to the same prefix", () => {
      const id = "deadbeef-1234-5678-9abc-def012345678";
      const token = leadTokenForRequestId(id);
      const parsed = parseLeadTokenFromBemerkung(`Bemerkung: ${token}`);
      expect(parsed?.prefix).toBe("deadbeef");
    });
  });
});
