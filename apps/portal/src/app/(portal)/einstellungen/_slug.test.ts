import { describe, expect, it } from "vitest";
import { keywordsWithName, slugifyTreatmentName, uniqueSlug } from "./_slug";

describe("slugifyTreatmentName (F-20)", () => {
  it("spells out umlauts and strips accents", () => {
    expect(slugifyTreatmentName("Faltenunterspritzung Stirn")).toBe("faltenunterspritzung-stirn");
    expect(slugifyTreatmentName("Lidstraffung (Ober- & Unterlid)")).toBe("lidstraffung-ober-unterlid");
    expect(slugifyTreatmentName("Brustvergrößerung")).toBe("brustvergroesserung");
    expect(slugifyTreatmentName("Peeling für Gesicht")).toBe("peeling-fuer-gesicht");
    expect(slugifyTreatmentName("Énergie Laser")).toBe("energie-laser");
  });

  it("caps the length without a trailing dash", () => {
    const slug = slugifyTreatmentName(`${"a".repeat(49)} b`);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back when nothing usable is left", () => {
    expect(slugifyTreatmentName("   ")).toBe("behandlung");
    expect(slugifyTreatmentName("!!!")).toBe("behandlung");
  });
});

describe("uniqueSlug", () => {
  it("returns the base or the first free numbered variant", () => {
    expect(uniqueSlug("botox", [])).toBe("botox");
    expect(uniqueSlug("botox", ["botox"])).toBe("botox-2");
    expect(uniqueSlug("botox", ["botox", "botox-2", "botox-3"])).toBe("botox-4");
  });
});

describe("keywordsWithName", () => {
  it("adds the name as first keyword, lowercased and deduplicated", () => {
    expect(keywordsWithName("Hyaluron", "Lippen, Falten, hyaluron")).toBe("hyaluron, lippen, falten");
  });
  it("uses the name alone when no keywords were typed", () => {
    expect(keywordsWithName("Fadenlifting", "")).toBe("fadenlifting");
    expect(keywordsWithName("Fadenlifting", null)).toBe("fadenlifting");
  });
  it("does not add very short names (substring matching would over-match)", () => {
    expect(keywordsWithName("OP", "nase")).toBe("nase");
    expect(keywordsWithName("OP", "")).toBeNull();
  });
});
