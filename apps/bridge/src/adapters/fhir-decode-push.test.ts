import { describe, it, expect } from "vitest";
import { healthHubAdapter } from "./healthhub/index.js";
import { redAdapter } from "./red/index.js";
import type { PvsLinkRow } from "../db/client.js";

/**
 * M-S7: decodePush guards JSON.parse. A malformed-but-correctly-signed body
 * must raise a decode error (which the inbound route turns into a 400) instead
 * of an unguarded parse throw that would 500 and invite an endless retry storm.
 */

function link(vendor: "healthhub" | "red"): PvsLinkRow {
  return {
    id: "link-1",
    clinicId: "00000000-0000-0000-0000-000000000009",
    pvsVendor: vendor,
    status: "connected",
    preferredPath: "auto",
    connectionConfig: {},
  };
}

describe("decodePush JSON guard (M-S7)", () => {
  it("healthhub throws a labeled decode error on malformed JSON", () => {
    expect(() =>
      healthHubAdapter.decodePush!(link("healthhub"), "{ not valid json", {})
    ).toThrow(/not valid JSON/);
  });

  it("red throws a labeled decode error on malformed JSON", () => {
    expect(() =>
      redAdapter.decodePush!(link("red"), "<<<garbage", {})
    ).toThrow(/not valid JSON/);
  });

  it("healthhub decodes a well-formed empty FHIR bundle without throwing", () => {
    const events = healthHubAdapter.decodePush!(
      link("healthhub"),
      JSON.stringify({ resourceType: "Bundle", entry: [] }),
      {}
    );
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(0);
  });
});
