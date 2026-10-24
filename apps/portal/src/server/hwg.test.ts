import { describe, expect, it } from "vitest";
import { checkHwg } from "./hwg";

const ids = (text: string) => [...new Set(checkHwg(text).findings.map((f) => f.ruleId))];

describe("checkHwg (F-19)", () => {
  it("flags the review example as a violation", () => {
    const r = checkHwg(
      "Jetzt -20 % auf Botox, garantierte Ergebnisse, Vorher/Nachher ansehen"
    );
    expect(r.verdict).toBe("violation");
    expect(ids("Jetzt -20 % auf Botox, garantierte Ergebnisse, Vorher/Nachher ansehen")).toEqual(
      expect.arrayContaining(["discount-medical", "guarantee", "before-after"])
    );
  });

  it.each([
    ["Vorher-Nachher", "before-after"],
    ["Vorher- und Nachher-Bilder", "before-after"],
    ["Vorher / Nachher", "before-after"],
    ["Before & After", "before-after"],
    ["before and after", "before-after"],
    ["Garantien", "guarantee"],
    ["mit Erfolgsgarantie", "guarantee"],
    ["100 % Erfolg", "guarantee"],
    ["völlig schmerzfrei", "pain-free"],
    ["ohne Risiko", "risk-free"],
    ["ohne jedes Risiko", "risk-free"],
    ["nebenwirkungsfreie Behandlung", "risk-free"],
    ["nur bei uns", "only-with-us"],
    ["Unsere Patientenstimmen", "testimonial-generic"],
    ["Ergebnis-Fotos", "before-after-soft"],
    ["Vergleichsbilder", "before-after-compare"],
    ["Botox jetzt 20 % günstiger", "discount-medical"],
    ["Rabatt auf Filler", "discount-medical"],
    ["das Wundermittel", "miracle"],
    ["revolutionäre Methode", "miracle"],
    ["Leiden Sie unter Falten?", "emotional-fear"],
  ])("%s -> %s", (text, rule) => {
    expect(ids(text)).toContain(rule);
  });

  it.each([
    "Wir beraten Sie ausführlich zu Ihrer Behandlung.",
    "Ein wunderbarer Tag in unserer Praxis.",
    "Vorher besprechen wir alles, nachher melden wir uns.",
    "Unser Team im Sales-Bereich",
    "Die Risiken besprechen wir offen mit Ihnen.",
  ])("stays clean: %s", (text) => {
    expect(checkHwg(text).verdict).toBe("clean");
  });

  it("is stable across repeated calls (global regex state)", () => {
    expect(checkHwg("Garantie").verdict).toBe("violation");
    expect(checkHwg("Garantie").verdict).toBe("violation");
  });
});
