import { describe, expect, it } from "vitest";
import { parseBerlinLocalInput } from "./berlin-input";

describe("parseBerlinLocalInput", () => {
  it("reads summer time input as CEST (UTC+2)", () => {
    expect(parseBerlinLocalInput("2026-10-08T14:00")?.toISOString()).toBe(
      "2026-10-08T12:00:00.000Z"
    );
  });

  it("reads winter time input as CET (UTC+1)", () => {
    expect(parseBerlinLocalInput("2026-12-01T09:30")?.toISOString()).toBe(
      "2026-12-01T08:30:00.000Z"
    );
  });

  it("accepts seconds", () => {
    expect(parseBerlinLocalInput("2026-01-15T23:59:30")?.toISOString()).toBe(
      "2026-01-15T22:59:30.000Z"
    );
  });

  it("handles the day after the DST switch", () => {
    // 2026-10-25 is the switch back to CET.
    expect(parseBerlinLocalInput("2026-10-26T08:00")?.toISOString()).toBe(
      "2026-10-26T07:00:00.000Z"
    );
    expect(parseBerlinLocalInput("2026-10-24T08:00")?.toISOString()).toBe(
      "2026-10-24T06:00:00.000Z"
    );
  });

  it("rejects malformed or impossible values", () => {
    expect(parseBerlinLocalInput("")).toBeNull();
    expect(parseBerlinLocalInput("2026-10-08")).toBeNull();
    expect(parseBerlinLocalInput("2026-02-31T10:00")).toBeNull();
    expect(parseBerlinLocalInput("2026-10-08T25:00")).toBeNull();
    expect(parseBerlinLocalInput("2026-10-08T14:00Z")).toBeNull();
  });
});
