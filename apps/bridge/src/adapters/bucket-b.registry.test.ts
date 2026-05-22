import { describe, it, expect } from "vitest";
import { pabauAdapter } from "./pabau/index.js";
import { consentzAdapter } from "./consentz/index.js";

/**
 * Bucket B adapters must register the right vendor name and expose the
 * polling-adapter surface (connect + initialSync + poll). Push-only
 * adapters omit poll; Bucket B is polling, so poll is required.
 *
 * Regression test for the scheduler ADAPTERS map: if either adapter
 * silently loses its `poll` method, the scheduler quietly stops syncing
 * Pabau/Consentz Praxen. This guards that wiring.
 */

describe("Bucket B adapter registry", () => {
  it("Pabau adapter declares vendor 'pabau' and is a polling adapter", () => {
    expect(pabauAdapter.vendor).toBe("pabau");
    expect(typeof pabauAdapter.connect).toBe("function");
    expect(typeof pabauAdapter.initialSync).toBe("function");
    expect(typeof pabauAdapter.poll).toBe("function");
  });

  it("Consentz adapter declares vendor 'consentz' and is a polling adapter", () => {
    expect(consentzAdapter.vendor).toBe("consentz");
    expect(typeof consentzAdapter.connect).toBe("function");
    expect(typeof consentzAdapter.initialSync).toBe("function");
    expect(typeof consentzAdapter.poll).toBe("function");
  });

  it("Neither Bucket B adapter exposes decodePush (push-only is FHIR territory)", () => {
    expect(pabauAdapter.decodePush).toBeUndefined();
    expect(consentzAdapter.decodePush).toBeUndefined();
  });
});
