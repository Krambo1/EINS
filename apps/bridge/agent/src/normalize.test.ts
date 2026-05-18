import { describe, it, expect } from "vitest";
import { parseGdtFile } from "./gdt-parser.js";
import { gdtToCanonical, type CanonicalEvent } from "./normalize.js";

/**
 * Coverage for the GDT → canonical translator: Satzart routing, the new
 * email/phone extraction, and the InvoicePaid emission from extended GDT
 * 8316 records carrying Honorar-FKs.
 */

function gdt(lines: Array<[string, string]>): Buffer {
  let body = "";
  for (const [fk, value] of lines) {
    const payload = `${fk}${value}`;
    const total = 3 + payload.length + 2;
    body += `${String(total).padStart(3, "0")}${payload}\r\n`;
  }
  return Buffer.from(body, "latin1");
}

async function canonical(
  lines: Array<[string, string]>
): Promise<CanonicalEvent[]> {
  const bytes = gdt(lines);
  const parsed = await parseGdtFile(bytes);
  return gdtToCanonical(parsed, {
    clinicId: "00000000-0000-0000-0000-000000000001",
    contentHash: parsed.contentHash,
  });
}

describe("normalize: Satzart routing", () => {
  it("6301 → single PatientUpserted", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-42"],
      ["3101", "Müller"],
      ["3102", "Maria"],
      ["3103", "15061980"],
      ["3110", "2"],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("PatientUpserted");
    expect(events[0].pvsPatientId).toBe("PAT-42");
    expect(events[0].fullName).toBe("Maria Müller");
    expect(events[0].dob).toBe("1980-06-15");
    expect(events[0].gender).toBe("f");
  });

  it("8316 without Honorar → PatientUpserted + EncounterCompleted", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8410", "GOÄ-2382"],
      ["8411", "Faltenunterspritzung"],
    ]);
    expect(events.map((e) => e.kind)).toEqual([
      "PatientUpserted",
      "EncounterCompleted",
    ]);
    const enc = events[1];
    expect(enc.treatmentCode).toBe("GOÄ-2382");
    expect(enc.treatmentLabel).toBe("Faltenunterspritzung");
  });

  it("unknown Satzart → empty array", async () => {
    const events = await canonical([
      ["8000", "9999"],
      ["3000", "PAT-X"],
    ]);
    expect(events).toEqual([]);
  });
});

describe("normalize: contact extraction", () => {
  it("extracts email from FK 3617", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3617", "Maria.Mueller@Example.com"],
    ]);
    expect(events[0].email).toBe("maria.mueller@example.com");
  });

  it("falls back to any FK containing a valid email", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3622", "Kontakt: patient@gmail.com bitte rückrufen"],
    ]);
    // Bemerkung FK 3622 contains an email but only as substring; we
    // should NOT extract substring-emails — full-cell only.
    expect(events[0].email).toBeUndefined();
  });

  it("picks mobile phone (FK 3628) over private (FK 3626)", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3626", "0221 12345"],
      ["3628", "+49 171 9999999"],
    ]);
    expect(events[0].phone).toBe("+49 171 9999999");
  });

  it("rejects malformed phone values", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3626", "bitte zurückrufen"],
    ]);
    expect(events[0].phone).toBeUndefined();
  });
});

describe("normalize: Honorar / InvoicePaid", () => {
  it("emits InvoicePaid when FK 8420 is present", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["6225", "RECH-2026-0042"],
      ["6228", "19052026"],
      ["8410", "GOÄ-2382"],
      ["8411", "Faltenunterspritzung"],
      ["8420", "350,00"],
    ]);
    const invoice = events.find((e) => e.kind === "InvoicePaid");
    expect(invoice).toBeDefined();
    expect(invoice!.pvsInvoiceId).toBe("RECH-2026-0042");
    expect(invoice!.amountCents).toBe(35000);
    expect(invoice!.paidAt).toBe("2026-05-19T00:00:00.000Z");
  });

  it("sums multiple Honorar-Positionen in one file", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["6225", "RECH-2026-0099"],
      ["8420", "150,00"],
      ["8420", "200,00"],
      ["8420", "75,50"],
    ]);
    const invoice = events.find((e) => e.kind === "InvoicePaid");
    expect(invoice!.amountCents).toBe(42550);
  });

  it("skips InvoicePaid when no Honorar-FKs present", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8410", "GOÄ-1"],
    ]);
    expect(events.find((e) => e.kind === "InvoicePaid")).toBeUndefined();
  });

  it("synthesises invoice id when FK 6225 is absent", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8420", "99,00"],
    ]);
    const invoice = events.find((e) => e.kind === "InvoicePaid");
    expect(invoice!.pvsInvoiceId).toMatch(/^gdt-honorar:PAT-1:/);
    expect(invoice!.amountCents).toBe(9900);
  });

  it("rejects zero-only invoices", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8420", "0,00"],
    ]);
    expect(events.find((e) => e.kind === "InvoicePaid")).toBeUndefined();
  });
});
