import { describe, expect, it } from "vitest";
import { slugifyClinicName } from "./slug";

describe("slugifyClinicName", () => {
  it("transliterates umlauts and strips punctuation", () => {
    expect(slugifyClinicName("Praxis Dr. Müller & Söhne, Köln")).toBe(
      "praxis-dr-mueller-soehne-koeln"
    );
  });
  it("keeps an already valid slug", () => {
    expect(slugifyClinicName("praxis-hartmann")).toBe("praxis-hartmann");
  });
  it("drops accents and edge dashes", () => {
    expect(slugifyClinicName("  -Clinique Évian- ")).toBe("clinique-evian");
  });
  it("returns empty for symbols only", () => {
    expect(slugifyClinicName("!!!")).toBe("");
  });
});
