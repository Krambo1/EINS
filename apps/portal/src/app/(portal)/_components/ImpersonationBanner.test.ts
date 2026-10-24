import { describe, expect, it } from "vitest";
import { isEndingSoon, remainingLabel } from "./ImpersonationBanner";

describe("remainingLabel", () => {
  const end = Date.parse("2026-10-07T12:30:00Z");
  it("counts down whole minutes", () => {
    expect(remainingLabel(end, end - 30 * 60_000)).toBe("noch 30 Min.");
    expect(remainingLabel(end, end - 23 * 60_000 - 59_000)).toBe("noch 23 Min.");
  });
  it("handles the last minute and expiry", () => {
    expect(remainingLabel(end, end - 30_000)).toBe("noch unter 1 Min.");
    expect(remainingLabel(end, end)).toBe("abgelaufen");
  });
});

describe("isEndingSoon", () => {
  const end = Date.parse("2026-10-07T12:30:00Z");
  it("is false with more than five minutes left", () => {
    expect(isEndingSoon(end, end - 6 * 60_000)).toBe(false);
  });
  it("is true in the last five minutes and after expiry", () => {
    expect(isEndingSoon(end, end - 5 * 60_000)).toBe(true);
    expect(isEndingSoon(end, end - 30_000)).toBe(true);
    expect(isEndingSoon(end, end + 1_000)).toBe(true);
  });
});
