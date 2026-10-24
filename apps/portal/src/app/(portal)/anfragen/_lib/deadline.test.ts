import { describe, expect, it } from "vitest";
import { formatDeadlineShort } from "./deadline";

describe("formatDeadlineShort", () => {
  it("formats in Berlin time with weekday", () => {
    // 11:00 UTC on Monday 12.10.2026 = 13:00 Berlin (CEST)
    expect(formatDeadlineShort(new Date("2026-10-12T11:00:00Z"))).toBe("Mo., 12.10., 13:00 Uhr");
  });

  it("returns a dash for missing values", () => {
    expect(formatDeadlineShort(null)).toBe("–");
  });
});
