import { describe, expect, it } from "vitest";
import { stoerungNoticeText } from "./clinic-notice";

describe("stoerungNoticeText (K-7 Teil 2)", () => {
  it("names the period, both guarantee limits in one paragraph, no em-dash", () => {
    const { subject, body } = stoerungNoticeText({
      reason: "Instagram hat das Konto der Praxis gesperrt",
      fromOn: "2026-11-03",
      toOn: "2026-11-09",
    });
    expect(subject).toContain("Plattform-Störung");
    expect(body).toContain("Vom 03.11.2026 bis zum 09.11.2026");
    const para = body.split("\n\n").find((p) => p.includes("90 Tagen"));
    expect(para).toContain("erste qualifizierte Anfrage über EINS");
    expect(body).not.toContain("—");
    expect(body).not.toMatch(/garantieren/i);
    // withDeadlineLine inserts before this marker.
    expect(body).toContain("\n\nWenn Sie Fragen haben");
  });

  it("says the Störung is ongoing without an end date", () => {
    const { body } = stoerungNoticeText({ reason: "Meta-Werbekonto gesperrt", fromOn: "2026-11-03", toOn: null });
    expect(body).toContain("Seit dem 03.11.2026");
    expect(body).toContain("Sie dauert bis heute an.");
  });
});
