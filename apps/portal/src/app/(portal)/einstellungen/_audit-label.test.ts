import { describe, expect, it } from "vitest";
import { auditLabel } from "./_audit-label";

describe("auditLabel", () => {
  it("turns the identifiers from VD3 into German", () => {
    expect(auditLabel("login", "login")).toBe("Anmeldung");
    expect(auditLabel("view", "request")).toBe("Anfrage angesehen");
    expect(auditLabel("impersonate_start", "login")).toBe("EINS hat Ihre Ansicht geöffnet");
    expect(auditLabel("reopen_discovery_fragebogen", "discovery_fragebogen")).toBe(
      "Fragebogen wieder geöffnet"
    );
  });

  it("never shows a raw identifier", () => {
    for (const [a, e] of [
      ["update", "unknown_table"],
      ["something_new", "request"],
      ["something_new", null],
    ] as const) {
      expect(auditLabel(a, e)).not.toMatch(/_|unknown|something/);
    }
    expect(auditLabel("something_new", null)).toBe("Sonstige Aktion");
  });
});
