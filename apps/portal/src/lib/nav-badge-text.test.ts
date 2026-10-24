import { describe, expect, it } from "vitest";
import { anfragenNavBadge } from "./nav-badge-text";

describe("anfragenNavBadge", () => {
  it("keeps the plain unread count when nothing is due", () => {
    expect(anfragenNavBadge(3, 0)).toBe(3);
    expect(anfragenNavBadge(0, 0)).toBe(0);
  });

  it("names due Wiedervorlagen", () => {
    expect(anfragenNavBadge(0, 2)).toBe("2 fällig");
    expect(anfragenNavBadge(4, 1)).toBe("4 neu · 1 fällig");
    expect(anfragenNavBadge(120, 150)).toBe("99+ neu · 99+ fällig");
  });
});
