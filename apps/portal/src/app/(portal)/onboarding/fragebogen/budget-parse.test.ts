import { describe, expect, it } from "vitest";
import { customBudgetError, formatBudgetEur, parseEuroAmount } from "./content";

describe("parseEuroAmount (F-26)", () => {
  it.each([
    ["2000", 2000],
    ["2.000", 2000],
    ["2.000 €", 2000],
    ["1.500,50 €", 1500],
    ["2.000,-", 2000],
    ["2000 EUR", 2000],
    ["12.500", 12500],
    ["500", 500],
    ["0", 0],
  ])("accepts %s", (raw, eur) => {
    expect(parseEuroAmount(raw)).toBe(eur);
  });

  it.each(["1.5", "2000-3000", "2000 bis 3000", "ca. 3 Mio", "abc", "", "1.50.000", "20.00"])(
    "rejects %s",
    (raw) => {
      expect(parseEuroAmount(raw)).toBeNull();
    }
  );

  it("submit check flags ranges, formatter groups thousands", () => {
    expect(customBudgetError({ F1: "2000-3000" })?.id).toBe("F1");
    expect(formatBudgetEur(2000)).toBe("2.000 €");
  });
});
