import { describe, expect, it } from "vitest";
import {
  ABSCHLUSS_HINWEIS,
  ALL_CHECKLIST_ITEMS,
  BLOCKER_CHECKLIST_IDS,
  CHECKLIST_BLOCKS,
  CHECKLIST_ITEMS_BY_ID,
  REQUIRED_CHECKLIST_IDS,
} from "./checkliste/content";
import {
  ALL_DISCOVERY_QUESTIONS,
  DISCOVERY_BLOCKS,
  DISCOVERY_INTRO,
  DISCOVERY_QUESTIONS_BY_ID,
  REQUIRED_DISCOVERY_IDS,
  customBudgetError,
} from "./fragebogen/content";

/**
 * Guards the storage contract and the KI-Klon content of the two onboarding
 * catalogs (Asset-Liefer-Checkliste, Discovery-Fragebogen). Item and question
 * ids key the stored rows, so they must stay stable; retired ids are never
 * reused with a new meaning.
 */

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

// Wording from the old model that must not come back into customer-facing text.
const OLD_MODEL = [
  /Produktionstag/,
  /Drehtag/,
  /Videodreh/,
  /Fotoshooting/,
  /Lernphase/,
  /Tag 22/,
  /sichere(n)? Start/,
  /Rücktritt bis/,
  /3,5 (qualif|Anfragen)/,
  /360 Tage/,
  /Mindest.?[Ww]erbebudget/,
  /Empfohlenes Minimum/,
  /Klinik/,
  /Kampagn/,
  /Vorher-Nachher-Material/,
  /—/,
  /10 Werktag/,
  /Genehmigungsfiktion/,
];

describe("Asset-Liefer-Checkliste catalog", () => {
  it("keeps unique ids and the counts (31 Punkte, 20 Pflicht, 5 Blocker)", () => {
    const ids = ALL_CHECKLIST_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(31);
    expect(REQUIRED_CHECKLIST_IDS).toHaveLength(20);
    expect(BLOCKER_CHECKLIST_IDS).toEqual(["A1", "A2", "A3", "A4", "A5"]);
  });

  it("retires C6 and E5 (asked twice) and E2's Einzugsgebiet field", () => {
    expect(CHECKLIST_ITEMS_BY_ID.has("C6")).toBe(false);
    expect(CHECKLIST_ITEMS_BY_ID.has("E5")).toBe(false);
    expect(CHECKLIST_ITEMS_BY_ID.get("E2")?.fields?.map((f) => f.key)).toEqual(["standorte"]);
  });

  it("organic start: the ad accounts (B3, B4) are not Pflicht", () => {
    const required = new Set<string>(REQUIRED_CHECKLIST_IDS);
    expect(required.has("B3")).toBe(false);
    expect(required.has("B4")).toBe(false);
  });

  it("A5 keeps its id, stays a required blocker and is the Klon-Aufnahme", () => {
    const a5 = CHECKLIST_ITEMS_BY_ID.get("A5");
    expect(a5).toBeDefined();
    expect(a5?.blocker).toBe(true);
    expect(a5?.required).toBe(true);
    expect(a5?.deliveryType).toBe("status");
    expect(a5?.title).toBe("Klon-Aufnahme und Einwilligung geliefert");
    expect(a5?.anleitung).toContain("3 Werktage nach Unterschrift");
  });

  it("retires F1 and adds the Einwilligung KI-Abbild und Stimme as F5", () => {
    expect(CHECKLIST_ITEMS_BY_ID.has("F1")).toBe(false);
    const f5 = CHECKLIST_ITEMS_BY_ID.get("F5");
    expect(f5?.title).toBe("Einwilligung KI-Abbild und Stimme");
    expect(f5?.deliveryType).toBe("upload");
    expect(f5?.required).toBe(true);
    expect(f5?.blocker).toBe(false);
    expect(f5?.role).toBe("inhaber");
  });

  it("retires D5 (Vorher-Nachher-Material) without reusing the id", () => {
    expect(CHECKLIST_ITEMS_BY_ID.has("D5")).toBe(false);
    const d = CHECKLIST_BLOCKS.find((b) => b.key === "D");
    expect(d?.items.map((i) => i.id)).toEqual(["D1", "D2", "D3", "D4", "D6"]);
    expect(d?.intro).toContain("keine Vorher-Nachher-Darstellungen");
  });

  it("adds F6 (Einwilligungen für vorhandenes Material) as a non-blocker", () => {
    const f6 = CHECKLIST_ITEMS_BY_ID.get("F6");
    expect(f6?.title).toBe("Einwilligungen für vorhandenes Material");
    expect(f6?.blocker).toBe(false);
    expect(f6?.required).toBe(false);
    expect(f6?.recommended).toBe(true);
    expect(f6?.allowKeineVorhanden).toBe(true);
    expect(f6?.deliveryType).toBe("upload_oder_link");
    expect(f6?.anleitung).toContain("Team");
    expect(f6?.anleitung).toContain("Patientenstimmen");
    expect(BLOCKER_CHECKLIST_IDS).not.toContain("F6");
  });

  it("Block G names the 2-Werktage Freigabe, Profil-Link, Tracking-Nummer", () => {
    const text = ABSCHLUSS_HINWEIS.points.join("\n");
    expect(text).toContain("innerhalb von 2 Werktagen");
    expect(text).toContain("Profil-Link");
    expect(text).toContain("Tracking-Nummer");
    expect(text).toContain("Empfehlung, keine Bedingung");
    // Garantie: both limits in the same paragraph.
    expect(text).toContain("erste qualifizierte Anfrage über EINS");
    expect(text).toContain("90 Tagen");
  });

  it("contains no wording from the old model", () => {
    const text = allStrings([CHECKLIST_BLOCKS, ABSCHLUSS_HINWEIS]).join("\n");
    for (const re of OLD_MODEL) expect(text).not.toMatch(re);
  });
});

describe("Discovery-Fragebogen catalog", () => {
  it("keeps unique question ids, 21 Fragen, 17 Pflicht", () => {
    const ids = ALL_DISCOVERY_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(21);
    expect(REQUIRED_DISCOVERY_IDS).toHaveLength(17);
  });

  it("retires A6, C4, D6, E3 and F2 without reusing the ids", () => {
    for (const id of ["A6", "C4", "D6", "E3", "F2"]) {
      expect(DISCOVERY_QUESTIONS_BY_ID.has(id)).toBe(false);
    }
  });

  it("F1 (Werbebudget) is optional and has no minimum or recommended floor", () => {
    const f1 = DISCOVERY_QUESTIONS_BY_ID.get("F1");
    expect(f1?.required).toBe(false);
    expect(f1 && "customMinEur" in f1).toBe(false);
    expect(f1 && "recommendedMinEur" in f1).toBe(false);
    expect(f1?.options).toContain("kein Werbebudget zu Beginn");
    expect(customBudgetError({ F1: "500" })).toBeNull();
    expect(customBudgetError({ F1: "kein Werbebudget zu Beginn" })).toBeNull();
  });

  it("the 48 Werkstunden rule stands in Was danach zählt: no guarantee condition", () => {
    // Block D of the Fragebogen dropped it on 2026-10-30; the Checkliste keeps it.
    const rule = ABSCHLUSS_HINWEIS.points.find((p) => p.includes("48 Werkstunden"));
    expect(rule).toContain("keine Bedingung der Garantie");
    expect(rule).toContain("von der Praxis nicht beantwortet");
    expect(rule).toContain("bezahlten Anzeigen pausieren");
    expect(rule).not.toMatch(/Garantie (entfällt|verfällt)|Pflicht/);
  });

  it("keeps the Ausgangswerte question (C2, Anfragen pro Monat)", () => {
    expect(DISCOVERY_QUESTIONS_BY_ID.get("C2")?.required).toBe(true);
  });

  it("contains no wording from the old model", () => {
    const text = allStrings([DISCOVERY_BLOCKS, DISCOVERY_INTRO]).join("\n");
    for (const re of OLD_MODEL) expect(text).not.toMatch(re);
  });
});
