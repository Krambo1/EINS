import { describe, expect, it } from "vitest";
import { berlinDayWindow } from "@/lib/dashboard-range";
import type { KpiSummary } from "@/server/queries/kpis";
import { monthlyMailRows } from "./monthly-report";

/**
 * The monthly mail repeats the Übersicht's 30-Tage Kennzahlen (the portal is
 * the monthly Auswertung, no PDF): same order, German formatting, and the
 * Werbeertrag only once Werbebudget ran.
 */
const win = berlinDayWindow("2026-10-03", "2026-11-01");

const organic: KpiSummary = {
  leads: 14,
  appointments: 6,
  consultationsHeld: 5,
  casesWon: 3,
  spendEur: 0,
  revenueEur: 4250,
  adRevenueEur: 0,
  roas: null,
  qualifiedAdLeads: 0,
  costPerQualifiedLead: null,
};

describe("monthlyMailRows", () => {
  it("lists the Übersicht figures in its order, without Werbeertrag when no Werbebudget ran", () => {
    const rows = monthlyMailRows(win, organic, "EUR");
    expect(rows.map((r) => r.label)).toEqual([
      "Zeitraum",
      "Anfragen",
      "Termine",
      "Behandlungen gewonnen",
      "Umsatz",
    ]);
    expect(rows[0]!.value).toBe("03.10.2026 bis 01.11.2026");
    expect(rows[1]!.value).toBe("14");
    expect(rows[4]!.value).toContain("€");
    expect(rows[4]!.value).not.toContain("EUR");
  });

  it("adds Werbeertrag and Kosten pro qualifizierter Anfrage once Werbebudget ran", () => {
    const rows = monthlyMailRows(
      win,
      { ...organic, spendEur: 600, roas: 7.08, qualifiedAdLeads: 14, costPerQualifiedLead: 42.86 },
      "EUR"
    );
    expect(rows.slice(-2).map((r) => r.label)).toEqual(["Werbeertrag", "Kosten pro qualifizierter Anfrage"]);
    expect(rows.at(-2)!.value).toBe("7,1×");
    expect(rows.at(-1)!.value).toMatch(/^43\s€$/);
    expect(rows.at(-1)!.value).toContain("€");
  });

  it("leaves the cost out while no Anfrage from ads is qualified", () => {
    const rows = monthlyMailRows(win, { ...organic, spendEur: 600, roas: 0, costPerQualifiedLead: null }, "EUR");
    expect(rows.map((r) => r.label)).not.toContain("Kosten pro qualifizierter Anfrage");
  });
});
