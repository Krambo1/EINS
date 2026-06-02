import { describe, it, expect } from "vitest";
import { formatMoney, formatEuro, formatClinicAggregate } from "./formatting";

/**
 * Multi-currency display (Phase 11). PVS revenue is held in the clinic's
 * billing currency; `formatMoney(value, currency)` is the render-site helper
 * and `formatEuro` is the EUR-only shorthand for agency-side money.
 */
describe("formatMoney", () => {
  it("formats EUR with the € symbol and de-DE separators", () => {
    const out = formatMoney(1234, "EUR");
    expect(out).toContain("€");
    expect(out).toContain("1.234");
    expect(out).not.toContain("CHF");
  });

  it("formats CHF with the CHF symbol for a Swiss Praxis", () => {
    const out = formatMoney(1234, "CHF");
    expect(out).toContain("CHF");
    expect(out).toContain("1.234");
    expect(out).not.toContain("€");
  });

  it("keeps EUR and CHF renderings of the same value distinct", () => {
    expect(formatMoney(5000, "EUR")).not.toEqual(formatMoney(5000, "CHF"));
  });

  it("honours the decimal option in either currency", () => {
    expect(formatMoney(1234.5, "CHF", { decimal: true })).toContain("1.234,50");
    expect(formatMoney(1234.5, "EUR", { decimal: true })).toContain("1.234,50");
  });

  it("renders an en-dash for null / NaN regardless of currency", () => {
    expect(formatMoney(null, "CHF")).toBe("–");
    expect(formatMoney(undefined, "EUR")).toBe("–");
    expect(formatMoney(Number.NaN, "CHF")).toBe("–");
  });

  it("defaults to EUR and matches formatEuro", () => {
    expect(formatMoney(987)).toEqual(formatEuro(987));
    expect(formatMoney(987, "EUR")).toEqual(formatEuro(987));
  });
});

describe("formatClinicAggregate", () => {
  it("formats in the single currency when the summed set is uniform EUR", () => {
    expect(formatClinicAggregate(1234, ["EUR", "EUR"])).toEqual(
      formatMoney(1234, "EUR")
    );
  });

  it("formats in CHF when every contributing Praxis bills CHF", () => {
    expect(formatClinicAggregate(1234, ["CHF"])).toEqual(
      formatMoney(1234, "CHF")
    );
  });

  it("suppresses a mixed EUR+CHF total instead of printing a wrong number", () => {
    expect(formatClinicAggregate(1234, ["EUR", "CHF"])).toBe("gemischt");
    expect(formatClinicAggregate(1234, ["CHF", "EUR"], { mixedLabel: "—" })).toBe(
      "—"
    );
  });

  it("treats an empty set as EUR (nothing summed)", () => {
    expect(formatClinicAggregate(0, [])).toEqual(formatMoney(0, "EUR"));
  });
});
