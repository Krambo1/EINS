import { describe, expect, it } from "vitest";
import { statusChangeLine } from "./_status-change";

describe("statusChangeLine", () => {
  it("shows from and to with German labels", () => {
    expect(statusChangeLine({ from: "kontaktiert", to: "termin_vereinbart" })).toBe(
      "Status: Kontaktiert → Termin vereinbart"
    );
    expect(statusChangeLine({ source: "pvs", from: "termin_vereinbart", to: "no_show" })).toBe(
      "Status: Termin vereinbart → Nicht erschienen"
    );
  });

  it("falls back to derivedStatus and to-only", () => {
    expect(statusChangeLine({ derivedStatus: "behandelt" })).toBe("Status: Behandelt");
    expect(statusChangeLine({ to: "neu" })).toBe("Status: Neu");
  });

  it("skips non-changes and unusable meta", () => {
    expect(statusChangeLine({ from: "gewonnen", to: "gewonnen" })).toBeNull();
    expect(statusChangeLine({ to: "irgendwas" })).toBeNull();
    expect(statusChangeLine(null)).toBeNull();
    expect(statusChangeLine("x")).toBeNull();
  });
});
