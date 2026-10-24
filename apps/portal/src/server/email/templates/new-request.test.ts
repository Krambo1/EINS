import { describe, expect, it } from "vitest";
import { isSafeTreatmentLabel, renderNewRequestEmail, treatmentLabelForMail } from "./new-request";

const BASE = {
  clinicName: "Praxis Test",
  sourceLabel: "Meta-Formular",
  receivedAtLabel: "07.10.2026, 18:30",
  link: "https://portal.eins.ag/anfragen/x",
};

describe("treatment label in the new-request mail (L-13)", () => {
  it("keeps plain treatment names", () => {
    expect(isSafeTreatmentLabel("Botox")).toBe(true);
    expect(isSafeTreatmentLabel("Hyaluron-Filler Lippen")).toBe(true);
    expect(isSafeTreatmentLabel("Brustvergrößerung")).toBe(true);
  });

  it("drops free text with names, numbers or addresses", () => {
    expect(isSafeTreatmentLabel("Brustvergrößerung, bin Brigitte Meier")).toBe(false);
    expect(isSafeTreatmentLabel("Botox 0171 1234567")).toBe(false);
    expect(isSafeTreatmentLabel("botox max@example.de")).toBe(false);
    expect(isSafeTreatmentLabel("ich hätte gern eine Beratung zu Botox")).toBe(false);
  });

  it("catalogue labels always pass, patient free text never", () => {
    expect(treatmentLabelForMail("Lidstraffung, Oberlid (beidseitig)", true)).toBe(
      "Lidstraffung, Oberlid (beidseitig)"
    );
    expect(treatmentLabelForMail("Botox", false)).toBeNull();
    expect(treatmentLabelForMail("Botox")).toBe("Botox");
  });

  it("an unsafe label never reaches subject, preview or text", () => {
    const m = renderNewRequestEmail({
      ...BASE,
      treatment: "Brustvergrößerung, bin Brigitte Meier, 0171 1234567",
    });
    expect(m.subject).toBe("Neue Anfrage über EINS");
    expect(m.text).not.toContain("Meier");
    expect(m.html).not.toContain("Meier");
    expect(m.text).toContain("Behandlung: Nicht angegeben");
  });
});
