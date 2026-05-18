import { describe, expect, it } from "vitest";
import type { LeadQuiz } from "@/server/leads";
import { notesAreSubstantive, scoreFromQuiz } from "./score-rules";

function baseQuiz(overrides: Partial<LeadQuiz> = {}): LeadQuiz {
  return {
    treatmentSlug: "botox-stirn",
    treatmentSelection: "stirn",
    treatmentCategory: "botox",
    branch: "qualified",
    hasPhone: false,
    marketingConsent: false,
    eventId: "evt_test",
    ...overrides,
  };
}

const GOOD_PHONE = "+49 30 12345678";
const LONG_NOTE = "Bitte um zeitnahen Beratungstermin, idealerweise vormittags.";

/**
 * Notes-bucket inputs are now produced by the caller (ai-score.ts: LLM or
 * rule-based fallback). These helpers let tests target the deterministic
 * scoring path without invoking the LLM.
 */
const NOTES_NONE = { notesIntentPoints: 0, notesIntentReasoning: "keine Notizen" };
const NOTES_RULES_7 = { notesIntentPoints: 7, notesIntentReasoning: "Notizen substantiell" };
const NOTES_LLM_15 = { notesIntentPoints: 15, notesIntentReasoning: "KI: hohe Kaufabsicht" };

describe("scoreFromQuiz", () => {
  it("hot lead: high-tier specific + asap + 5km + valid phone + had-this + max LLM notes → 100", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSlug: "rhino-muenchen",
        treatmentSelection: "hoecker",
        treatmentCategory: "rhino",
        timeframe: "asap",
        experience: "had-this",
        hasPhone: true,
        notes: LONG_NOTE,
      }),
      distanceKm: 5,
      contactPhone: GOOD_PHONE,
      ...NOTES_LLM_15,
    });

    // 24 + 24 + 24 + 9 + 9 + 15 = 105 → clamped to 100
    expect(result.score).toBe(100);
    expect(result.category).toBe("hot");
    expect(result.breakdown).toEqual({
      treatment: 24, // rhino base 20 + specific +5 → clamped to 24
      timeframe: 24,
      distance: 24,
      phone: 9,
      experience: 9,
      notes: 15,
    });
  });

  it("warm lead: botox + specific + this-month + 50km + phone", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSelection: "stirn",
        timeframe: "this-month",
        hasPhone: true,
      }),
      distanceKm: 50,
      contactPhone: GOOD_PHONE,
      ...NOTES_NONE,
    });

    // botox 9 + specific +5 = 14; this-month 21; 50km 9; phone 9; exp default 4; no notes
    expect(result.score).toBe(57);
    expect(result.category).toBe("warm");
  });

  it("cold lead: later + unsicher + 400km", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSelection: "unsicher",
        timeframe: "later",
        hasPhone: false,
      }),
      distanceKm: 400,
      ...NOTES_NONE,
    });

    // botox 9 - 3 = 6; later 4; 0; 0; exp default 4; 0 → 14
    expect(result.score).toBe(14);
    expect(result.category).toBe("cold");
  });

  it("info-only branch forces category=cold and clamps score to ≤ 39", () => {
    // Build a quiz that would otherwise score very high.
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSlug: "rhino-muenchen",
        treatmentCategory: "rhino",
        branch: "info-only",
        treatmentSelection: "hoecker",
        timeframe: "info-only",
        experience: "had-this",
        hasPhone: true,
        notes: LONG_NOTE,
      }),
      distanceKm: 5,
      contactPhone: GOOD_PHONE,
      ...NOTES_RULES_7,
    });

    expect(result.category).toBe("cold");
    expect(result.score).toBeLessThanOrEqual(39);
  });

  it("info-only with already-low score is left unchanged", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        branch: "info-only",
        treatmentSelection: "unsicher",
        timeframe: "info-only",
      }),
      distanceKm: 400,
      ...NOTES_NONE,
    });

    // botox 6 + 0 + 0 + 0 + exp 4 + 0 = 10
    expect(result.score).toBe(10);
    expect(result.category).toBe("cold");
  });

  it("missing distance (geocode failed) awards 0 distance points but still scores", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        timeframe: "this-month",
        hasPhone: true,
      }),
      distanceKm: null,
      contactPhone: GOOD_PHONE,
      ...NOTES_NONE,
    });

    // 14 + 21 + 0 + 9 + exp 4 + 0 = 48
    expect(result.score).toBe(48);
    expect(result.category).toBe("warm");
    expect(result.reasoning).toContain("unbekannt");
  });

  it("missing timeframe (defensive fallback) awards 0 timeframe points", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        timeframe: undefined,
        hasPhone: true,
      }),
      distanceKm: 5,
      contactPhone: GOOD_PHONE,
      ...NOTES_NONE,
    });

    // 14 + 0 + 24 + 9 + exp 4 + 0 = 51
    expect(result.score).toBe(51);
    expect(result.category).toBe("warm");
  });

  // ─── Notes-bucket: now driven by inputs from the caller (LLM or rule) ────

  it("notes bucket reflects the caller-supplied points (0 when zero passed in)", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap" }),
      distanceKm: 5,
      ...NOTES_NONE,
    });

    expect(result.breakdown.notes).toBe(0);
    expect(result.reasoning).toContain("Notizen 0 (keine Notizen)");
  });

  it("notes bucket reflects the caller-supplied points (7 from rule fallback)", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap" }),
      distanceKm: 5,
      ...NOTES_RULES_7,
    });

    expect(result.breakdown.notes).toBe(7);
    expect(result.reasoning).toContain("Notizen 7 (Notizen substantiell)");
  });

  it("LLM may award up to 15 notes points; total still clamps at 100", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSlug: "rhino-muenchen",
        treatmentSelection: "hoecker",
        treatmentCategory: "rhino",
        timeframe: "asap",
        experience: "had-this",
        hasPhone: true,
      }),
      distanceKm: 5,
      contactPhone: GOOD_PHONE,
      ...NOTES_LLM_15,
    });

    // 24 + 24 + 24 + 9 + 9 + 15 = 105 → clamped to 100
    expect(result.breakdown.notes).toBe(15);
    expect(result.score).toBe(100);
    expect(result.reasoning).toContain("Notizen 15 (KI: hohe Kaufabsicht)");
  });

  it("notes input is clamped to [0, 15] defensively if a bad value sneaks through", () => {
    const overshoot = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap" }),
      distanceKm: 5,
      notesIntentPoints: 42,
      notesIntentReasoning: "KI: out-of-range",
    });
    expect(overshoot.breakdown.notes).toBe(15);

    const undershoot = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap" }),
      distanceKm: 5,
      notesIntentPoints: -5,
      notesIntentReasoning: "KI: negative",
    });
    expect(undershoot.breakdown.notes).toBe(0);
  });

  it("reasoning string is human-readable, includes Erfahrung, omits Marketing", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap", hasPhone: true }),
      distanceKm: 5,
      contactPhone: GOOD_PHONE,
      ...NOTES_NONE,
    });

    expect(result.reasoning).toMatch(/^Behandlung \d+/);
    expect(result.reasoning).toContain("Erfahrung");
    expect(result.reasoning).not.toContain("Marketing");
    expect(result.reasoning).toMatch(/= \d+ \(\w+\)/);
  });

  // ─── New cases that nail down the rewrite ────────────────────────────────

  it("high-tier specific beats kombination of the same category (regression)", () => {
    const specific = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSlug: "brust-x",
        treatmentCategory: "brust",
        treatmentSelection: "vergroesserung",
        timeframe: "asap",
      }),
      distanceKm: 5,
      ...NOTES_NONE,
    });

    const kombi = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentSlug: "brust-x",
        treatmentCategory: "brust",
        treatmentSelection: "kombination",
        timeframe: "asap",
      }),
      distanceKm: 5,
      ...NOTES_NONE,
    });

    // brust 20 + specific +5 = 25 → clamped to 24; brust 20 + kombi +3 = 23
    expect(specific.breakdown.treatment).toBe(24);
    expect(kombi.breakdown.treatment).toBe(23);
    expect(specific.score).toBeGreaterThan(kombi.score);
  });

  it("marketing consent has no effect on score", () => {
    const withConsent = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap", marketingConsent: true }),
      distanceKm: 5,
      ...NOTES_NONE,
    });
    const withoutConsent = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap", marketingConsent: false }),
      distanceKm: 5,
      ...NOTES_NONE,
    });
    expect(withConsent.score).toBe(withoutConsent.score);
  });

  it("fake phone (all zeros) earns 0 phone points even when hasPhone is true", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap", hasPhone: true }),
      distanceKm: 5,
      contactPhone: "00000000",
      ...NOTES_NONE,
    });
    expect(result.breakdown.phone).toBe(0);
  });

  it("phone with fewer than 8 digits earns 0 phone points", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap", hasPhone: true }),
      distanceKm: 5,
      contactPhone: "+49 1234",
      ...NOTES_NONE,
    });
    expect(result.breakdown.phone).toBe(0);
  });

  it("phone missing while hasPhone=true earns 0 phone points", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({ timeframe: "asap", hasPhone: true }),
      distanceKm: 5,
      contactPhone: null,
      ...NOTES_NONE,
    });
    expect(result.breakdown.phone).toBe(0);
  });

  it("experience: had-this awards 9, had-similar 6, first 2, not-asked 4", () => {
    const make = (exp: LeadQuiz["experience"]) =>
      scoreFromQuiz({
        quiz: baseQuiz({ timeframe: "asap", experience: exp }),
        distanceKm: 5,
        ...NOTES_NONE,
      }).breakdown.experience;

    expect(make("had-this")).toBe(9);
    expect(make("had-similar")).toBe(6);
    expect(make("first")).toBe(2);
    expect(make(undefined)).toBe(4);
  });

  it("treatment-value tiers: rhino > filler > botox at equal specificity", () => {
    const make = (cat: string) =>
      scoreFromQuiz({
        quiz: baseQuiz({
          treatmentCategory: cat,
          treatmentSelection: "spezifisch",
        }),
        distanceKm: null,
        ...NOTES_NONE,
      }).breakdown.treatment;

    expect(make("rhino")).toBe(24); // 20 + 5 → clamped to 24
    expect(make("filler")).toBe(19); // 14 + 5
    expect(make("botox")).toBe(14); // 9 + 5
  });

  it("treatment-value floor of 4 for botox + unsicher (9 − 3 = 6, above floor)", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentCategory: "botox",
        treatmentSelection: "unsicher",
      }),
      distanceKm: null,
      ...NOTES_NONE,
    });
    expect(result.breakdown.treatment).toBe(6);
  });

  it("missing treatmentCategory falls back to neutral mid-tier (12 base)", () => {
    const result = scoreFromQuiz({
      quiz: baseQuiz({
        treatmentCategory: undefined,
        treatmentSelection: "spezifisch",
      }),
      distanceKm: null,
      ...NOTES_NONE,
    });
    // base 12 + specific +5 = 17
    expect(result.breakdown.treatment).toBe(17);
  });
});

// ─── notesAreSubstantive is now the deterministic fallback used by the
//    caller (ai-score.ts) when the LLM is unavailable. Keep its semantics
//    pinned here so regressions surface even though scoreFromQuiz no longer
//    calls it internally.
describe("notesAreSubstantive (rule-based fallback)", () => {
  it("returns false for undefined / empty / whitespace", () => {
    expect(notesAreSubstantive(undefined)).toBe(false);
    expect(notesAreSubstantive("")).toBe(false);
    expect(notesAreSubstantive("   ")).toBe(false);
  });

  it("returns false for strings under 20 chars", () => {
    expect(notesAreSubstantive("kurz")).toBe(false);
    expect(notesAreSubstantive("Bitte zurueckrufen")).toBe(false); // 18
  });

  it("returns false for ≥ 20 chars without two 4+ letter words (length-spam)", () => {
    expect(notesAreSubstantive("asdfasdfasdfasdfasdfasdf")).toBe(false);
    expect(notesAreSubstantive("aa bb cc dd ee ff gg hh ii")).toBe(false);
  });

  it("returns true for ≥ 20 chars with at least two real 4+ letter words", () => {
    expect(notesAreSubstantive("Bitte um zeitnahen Beratungstermin")).toBe(true);
    expect(notesAreSubstantive("Hier ist eine ausreichend lange Notiz mit Kontext.")).toBe(true);
  });
});
