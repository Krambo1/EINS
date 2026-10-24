import { describe, expect, it } from "vitest";
import {
  MANUAL_ENTRY_REPEAT_BODY,
  manualEntryLeadInput,
  parseManualEntry,
  TREATMENT_OPEN,
} from "./manual-entry";
import { SELF_REPORTED_SOURCES, attributionConfidence, classifyAttribution } from "./sources";

const TREATMENT = "0b0f4a52-3c1e-4d7a-9a0e-5f1f6f4f2a11";

const base = {
  contactName: "  Anna Beispiel ",
  contactPhone: "0171 1112222",
  contactEmail: "",
  treatmentId: TREATMENT,
  selfReportedSource: "anruf_praxis",
};

describe("parseManualEntry", () => {
  it("accepts phone only and trims, empty e-mail becomes null", () => {
    const r = parseManualEntry(base);
    expect(r).toEqual({
      ok: true,
      entry: {
        contactName: "Anna Beispiel",
        contactPhone: "0171 1112222",
        contactEmail: null,
        treatmentId: TREATMENT,
        selfReportedSource: "anruf_praxis",
      },
    });
  });

  it("accepts e-mail only", () => {
    const r = parseManualEntry({ ...base, contactPhone: "", contactEmail: "anna@example.test" });
    expect(r.ok && r.entry.contactEmail).toBe("anna@example.test");
    expect(r.ok && r.entry.contactPhone).toBeNull();
  });

  it("needs phone or e-mail", () => {
    const r = parseManualEntry({ ...base, contactPhone: " ", contactEmail: "" });
    expect(r).toEqual({
      ok: false,
      message: "Bitte geben Sie eine Telefonnummer oder eine E-Mail-Adresse an.",
    });
  });

  it("rejects a missing name, a bad e-mail and a phone without digits", () => {
    expect(parseManualEntry({ ...base, contactName: "  " }).ok).toBe(false);
    expect(parseManualEntry({ ...base, contactEmail: "kein-at" }).ok).toBe(false);
    expect(parseManualEntry({ ...base, contactPhone: "abc" }).ok).toBe(false);
  });

  it("accepts all seven sources incl. Anruf in der Praxis, nothing else", () => {
    for (const s of SELF_REPORTED_SOURCES) {
      expect(parseManualEntry({ ...base, selfReportedSource: s }).ok).toBe(true);
    }
    for (const s of [undefined, "", "Instagram", "formular", "messweg"]) {
      expect(parseManualEntry({ ...base, selfReportedSource: s }).ok).toBe(false);
    }
  });

  it("treats 'Noch offen' as no treatment and rejects a non-uuid", () => {
    const open = parseManualEntry({ ...base, treatmentId: TREATMENT_OPEN });
    expect(open.ok && open.entry.treatmentId).toBeNull();
    expect(parseManualEntry({ ...base, treatmentId: "1; drop" }).ok).toBe(false);
  });

  it("ignores smuggled fields (clinicId, source, utm)", () => {
    const r = parseManualEntry({
      ...base,
      clinicId: "11111111-1111-1111-1111-111111111111",
      source: "formular",
      utm: { utm_medium: "profil_link" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.entry).sort()).toEqual([
      "contactEmail",
      "contactName",
      "contactPhone",
      "selfReportedSource",
      "treatmentId",
    ]);
  });
});

describe("manualEntryLeadInput", () => {
  const parsed = parseManualEntry(base);
  if (!parsed.ok) throw new Error("fixture");

  it("maps to source manuell with the 30-day same-contact rule and no consent record", () => {
    const input = manualEntryLeadInput(parsed.entry, "Lidstraffung");
    expect(input).toEqual({
      source: "manuell",
      selfReportedSource: "anruf_praxis",
      contactName: "Anna Beispiel",
      contactPhone: "0171 1112222",
      contactEmail: null,
      treatmentWish: "Lidstraffung",
      dsgvoConsent: false,
      consents: null,
      utm: null,
      sameContactWithinDays: 30,
      sameContactActivity: { body: MANUAL_ENTRY_REPEAT_BODY, meta: { entry: "manuell" }, kind: "note" },
    });
  });

  it("is never a Messweg and is a Praxis-Eingabe whatever the self-report says", () => {
    for (const s of SELF_REPORTED_SOURCES) {
      const input = manualEntryLeadInput({ ...parsed.entry, selfReportedSource: s }, null);
      expect(classifyAttribution({ source: input.source, utm: input.utm }).messweg).toBeNull();
      expect(
        attributionConfidence({ source: input.source, selfReportedSource: input.selfReportedSource })
      ).toBe("praxis_eingabe");
    }
  });
});
