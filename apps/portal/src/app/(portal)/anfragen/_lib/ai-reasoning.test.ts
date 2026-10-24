import { describe, expect, it } from "vitest";
import { germanAiReasoning } from "./ai-reasoning";

describe("germanAiReasoning", () => {
  it("maps the rule scorer's raw codes", () => {
    const raw =
      "Behandlung 22 (rhino/Kombination), Zeitfenster 24 (asap), Distanz 24 (12km), Telefon 10, Erfahrung 9 (hatte gleiche), Notizen 5 (Notizen substantiell), = 74 (hot)";
    expect(germanAiReasoning(raw)).toBe(
      "Behandlung 22 (Nase/Kombination), Zeitfenster 24 (so schnell wie möglich), Distanz 24 (12km), Telefon 10, Erfahrung 9 (hatte gleiche), Notizen 5 (Notizen substantiell), = 74 (gute Passung)"
    );
  });

  it("maps info-only and cold", () => {
    expect(germanAiReasoning("Zeitfenster 0 (nur Info), = 12 (cold, info-only)")).toBe(
      "Zeitfenster 0 (nur Info), = 12 (geringe Passung, nur Info)"
    );
  });

  it("maps the activity prefix and the filler slug", () => {
    expect(
      germanAiReasoning("COLD (32): Behandlung 19 (filler/Botox), Telefon 0, = 32 (cold)")
    ).toBe("32 von 100, geringe Passung: Behandlung 19 (Hyaluron-Filler/Botox), Telefon 0, = 32 (geringe Passung)");
    expect(germanAiReasoning("WARM (55): = 55 (warm)")).toBe(
      "55 von 100, mittlere Passung: = 55 (mittlere Passung)"
    );
  });

  it("maps the seeded 'Score N (hot)' text", () => {
    expect(
      germanAiReasoning("Score 80 (hot): basierend auf Nachrichtenlänge, Terminbereitschaft, Budget-Indikation.")
    ).toBe("80 von 100, gute Passung: basierend auf Nachrichtenlänge, Terminbereitschaft, Budget-Indikation.");
  });

  it("maps the heuristic path and drops the em-dash", () => {
    expect(germanAiReasoning("Tier anti-aging (+12), Budget genannt")).toBe(
      "Behandlung Verjüngung (+12), Budget genannt"
    );
    expect(germanAiReasoning("keine starken Signale — Standardbewertung")).toBe(
      "keine starken Signale, Standardbewertung"
    );
  });

  it("leaves free text alone", () => {
    expect(germanAiReasoning("Notizen 12 (KI: will asap einen Termin)")).toBe(
      "Notizen 12 (KI: will asap einen Termin)"
    );
    expect(germanAiReasoning("Status kontaktiert")).toBe("Status kontaktiert");
  });
});
