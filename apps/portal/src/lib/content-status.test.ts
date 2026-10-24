import { describe, expect, it } from "vitest";
import { CONTENT_STATUSES, canAdminMove, canPraxisDecide, canPublish } from "./content-status";

describe("content status rules", () => {
  it("only the Praxis approves or asks for changes", () => {
    for (const from of CONTENT_STATUSES) {
      expect(canAdminMove(from, "freigegeben")).toBe(false);
      expect(canAdminMove(from, "aenderung")).toBe(false);
    }
    expect(canPraxisDecide("zur_freigabe", "freigegeben")).toBe(true);
    expect(canPraxisDecide("zur_freigabe", "aenderung")).toBe(true);
    expect(canPraxisDecide("entwurf", "freigegeben")).toBe(false);
    expect(canPraxisDecide("zur_freigabe", "live")).toBe(false);
  });

  it("nothing goes live without approval", () => {
    expect(canAdminMove("entwurf", "live")).toBe(false);
    expect(canAdminMove("zur_freigabe", "live")).toBe(false);
    expect(canAdminMove("aenderung", "live")).toBe(false);
    expect(canAdminMove("freigegeben", "live")).toBe(true);
    expect(canPublish("entwurf")).toBe(false);
    expect(canPublish("zur_freigabe")).toBe(false);
    expect(canPublish("freigegeben")).toBe(true);
  });

  it("a stopped post stays stopped", () => {
    for (const to of CONTENT_STATUSES) expect(canAdminMove("gestoppt", to)).toBe(false);
    expect(canPublish("gestoppt")).toBe(false);
  });
});
