import { describe, expect, it } from "vitest";
import { cloudLinkIsSilent } from "./pvs-reconcile";

/**
 * Pass 2: the stale-bridge email used a 6 h wall-clock rule and fired for
 * every Praxis every night and every weekend. A cloud link is now silent only
 * after two Berlin working days without an event.
 */
describe("cloudLinkIsSilent", () => {
  it("a weekend without events is not silent", () => {
    // Fri 2026-10-02 18:00 Berlin -> Mon 2026-10-05 09:00 Berlin.
    expect(
      cloudLinkIsSilent(
        new Date("2026-10-02T16:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-10-05T07:00:00Z")
      )
    ).toBe(false);
  });

  it("one night without events is not silent", () => {
    expect(
      cloudLinkIsSilent(
        new Date("2026-10-06T17:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-10-07T07:00:00Z")
      )
    ).toBe(false);
  });

  it("three working days without events is silent", () => {
    // Mon 2026-10-05 09:00 Berlin -> Thu 2026-10-08 10:00 Berlin.
    expect(
      cloudLinkIsSilent(
        new Date("2026-10-05T07:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-10-08T08:00:00Z")
      )
    ).toBe(true);
  });

  it("a link that never delivered is measured from its creation", () => {
    expect(
      cloudLinkIsSilent(
        null,
        new Date("2026-10-05T07:00:00Z"),
        new Date("2026-10-06T07:00:00Z")
      )
    ).toBe(false);
    expect(
      cloudLinkIsSilent(
        null,
        new Date("2026-09-28T07:00:00Z"),
        new Date("2026-10-07T07:00:00Z")
      )
    ).toBe(true);
  });
});
