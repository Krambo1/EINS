import { describe, expect, it } from "vitest";
import { distanceKm } from "./haversine";

describe("distanceKm", () => {
  it("returns 0 for identical points", () => {
    const munich = { lat: 48.1372, lng: 11.5755 };
    expect(distanceKm(munich, munich)).toBe(0);
  });

  it("matches known München→Hamburg great-circle ≈ 614 km", () => {
    const munich = { lat: 48.1372, lng: 11.5755 };
    const hamburg = { lat: 53.5511, lng: 9.9937 };
    const km = distanceKm(munich, hamburg);
    // Real great-circle is ~612.5 km; haversine should be within a few km.
    expect(km).toBeGreaterThan(605);
    expect(km).toBeLessThan(625);
  });

  it("matches München→Augsburg ≈ 56 km (within tier-2 band)", () => {
    const munich = { lat: 48.1372, lng: 11.5755 };
    const augsburg = { lat: 48.3705, lng: 10.8978 };
    const km = distanceKm(munich, augsburg);
    expect(km).toBeGreaterThan(50);
    expect(km).toBeLessThan(60);
  });

  it("is symmetric: d(a,b) === d(b,a)", () => {
    const a = { lat: 50.1109, lng: 8.6821 };
    const b = { lat: 48.7758, lng: 9.1829 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });
});
