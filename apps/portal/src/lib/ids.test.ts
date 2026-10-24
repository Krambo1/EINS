import { describe, it, expect } from "vitest";
import { isUuid } from "./ids";

describe("isUuid", () => {
  it("accepts canonical UUIDs in any case and rejects everything else", () => {
    expect(isUuid("d1e2f3a4-b5c6-4d7e-8f90-1a2b3c4d5e6f")).toBe(true);
    expect(isUuid("D1E2F3A4-B5C6-4D7E-8F90-1A2B3C4D5E6F")).toBe(true);
    expect(isUuid("d1e2f3a4b5c64d7e8f901a2b3c4d5e6f")).toBe(false);
    expect(isUuid(" d1e2f3a4-b5c6-4d7e-8f90-1a2b3c4d5e6f")).toBe(false);
    expect(isUuid("../etc/passwd")).toBe(false);
  });
});
