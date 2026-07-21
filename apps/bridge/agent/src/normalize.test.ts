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

async function canonicalWithMtime(
  lines: Array<[string, string]>,
  fileModifiedAtIso: string | undefined
): Promise<CanonicalEvent[]> {
  const bytes = gdt(lines);
  const parsed = await parseGdtFile(bytes);
  return gdtToCanonical(parsed, {
    clinicId: "00000000-0000-0000-0000-000000000001",
    contentHash: parsed.contentHash,
    fileModifiedAtIso,
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

describe("normalize: refunds and amount parsing (H1 / H3.1)", () => {
  it("maps a negative FK 8420 (Storno) to InvoiceRefunded, not a dropped/paid event", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["6225", "RECH-STORNO-7"],
      ["6228", "19052026"],
      ["8420", "-350,00"],
    ]);
    expect(events.find((e) => e.kind === "InvoicePaid")).toBeUndefined();
    const refund = events.find((e) => e.kind === "InvoiceRefunded");
    expect(refund).toBeDefined();
    expect(refund!.refundedAmountCents).toBe(35000);
    expect(refund!.pvsInvoiceId).toBe("RECH-STORNO-7");
    // Distinct id namespace so a refund can't collide with the paid event.
    expect(refund!.pvsExternalEventId).toBe("gdt:inv-refund:RECH-STORNO-7");
    expect(refund!.refundedAt).toBe("2026-05-19T00:00:00.000Z");
  });

  it("nets a charge + storno in the same Satz to a signed total", async () => {
    // 350 charged, 350 stornoed in the same Satz -> zero net -> no signal.
    const zero = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8420", "350,00"],
      ["8420", "-350,00"],
    ]);
    expect(zero.find((e) => e.kind === "InvoicePaid")).toBeUndefined();
    expect(zero.find((e) => e.kind === "InvoiceRefunded")).toBeUndefined();
    // 350 charged, 500 stornoed -> net -150 -> refund of 150.
    const net = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8420", "350,00"],
      ["8420", "-500,00"],
    ]);
    const refund = net.find((e) => e.kind === "InvoiceRefunded");
    expect(refund!.refundedAmountCents).toBe(15000);
  });

  it.each([
    ["999", 99900],
    ["1000", 100000],
    ["1.234,50", 123450],
    ["1,250.00", 125000],
    ["1234,5", 123450],
  ] as const)(
    "parses FK 8420 '%s' as %i cents with NO magnitude heuristic",
    async (amount, expected) => {
      const events = await canonical([
        ["8000", "8316"],
        ["3000", "PAT-1"],
        ["8420", amount],
      ]);
      const invoice = events.find((e) => e.kind === "InvoicePaid");
      expect(invoice).toBeDefined();
      expect(invoice!.amountCents).toBe(expected);
    }
  );
});

describe("normalize: multi-Satz BDT batch (reliability review C2)", () => {
  it("emits one PatientUpserted per Satz instead of collapsing to patient #1", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3101", "Müller"],
      ["8000", "6301"],
      ["3000", "PAT-2"],
      ["3101", "Schmidt"],
      ["8000", "6301"],
      ["3000", "PAT-3"],
      ["3101", "Weber"],
    ]);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual([
      "PatientUpserted",
      "PatientUpserted",
      "PatientUpserted",
    ]);
    expect(events.map((e) => e.pvsPatientId)).toEqual([
      "PAT-1",
      "PAT-2",
      "PAT-3",
    ]);
    // Event ids must be distinct across Sätze.
    const ids = new Set(events.map((e) => e.pvsExternalEventId));
    expect(ids.size).toBe(3);
  });

  it("sums Honorar per Satz, never across patients", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["6225", "RECH-1"],
      ["8420", "100,00"],
      ["8420", "50,00"],
      ["8000", "8316"],
      ["3000", "PAT-2"],
      ["6225", "RECH-2"],
      ["8420", "200,00"],
    ]);
    const invoices = events.filter((e) => e.kind === "InvoicePaid");
    expect(invoices).toHaveLength(2);
    const byPatient = Object.fromEntries(
      invoices.map((i) => [i.pvsPatientId as string, i.amountCents])
    );
    // Patient 1: 100 + 50 = 150 €. Patient 2: 200 €. NOT 350 € on patient 1.
    expect(byPatient["PAT-1"]).toBe(15000);
    expect(byPatient["PAT-2"]).toBe(20000);
  });

  it("keeps historical event ids for single-Satz files (no :s0 suffix)", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-42"],
    ]);
    expect(events[0].pvsExternalEventId).toMatch(/^gdt:patient:PAT-42:[0-9a-f]+$/);
    expect(events[0].pvsExternalEventId).not.toContain(":s0");
  });

  it("gives two Sätze for the SAME patient distinct encounter ids", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8410", "GOÄ-1"],
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["8410", "GOÄ-2"],
    ]);
    const encounters = events.filter((e) => e.kind === "EncounterCompleted");
    expect(encounters).toHaveLength(2);
    expect(encounters[0].pvsEncounterId).not.toBe(encounters[1].pvsEncounterId);
  });
});

describe("normalize: calendar date validation (M-P5)", () => {
  it("rejects an impossible GDT date (99999999) rather than shipping 9999-99-99", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3103", "99999999"], // Geburtsdatum with an impossible day/month
    ]);
    // Invalid dob is dropped (undefined), not shipped as a garbage date.
    expect(events[0].kind).toBe("PatientUpserted");
    expect(events[0].dob).toBeUndefined();
  });

  it("accepts a valid GDT date", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3103", "29022024"], // real leap day
    ]);
    expect(events[0].dob).toBe("2024-02-29");
  });
});

describe("normalize: missing FK 3000 drops the event (M-P6)", () => {
  it("drops a 6301 Satz with no patient FK 3000 instead of fabricating a phantom", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3101", "Müller"], // has a name but NO FK 3000
    ]);
    expect(events).toEqual([]);
  });

  it("drops an 8316 Satz with no FK 3000 (no phantom patient/encounter/invoice)", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["8420", "350,00"],
      ["6225", "RECH-1"],
    ]);
    expect(events).toEqual([]);
  });

  it("in a multi-Satz batch, drops only the Satz missing FK 3000", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3101", "Müller"],
      ["8000", "6301"],
      ["3101", "Schmidt"], // no FK 3000 -> dropped
      ["8000", "6301"],
      ["3000", "PAT-3"],
      ["3101", "Weber"],
    ]);
    expect(events.map((e) => e.pvsPatientId)).toEqual(["PAT-1", "PAT-3"]);
  });
});

describe("normalize: unparseable invoice date skips the event (M-P7)", () => {
  it("skips the InvoicePaid when a date-only field (8431) is present but unparseable", async () => {
    const events = await canonical([
      ["8000", "8316"],
      ["3000", "PAT-1"],
      ["6225", "RECH-BAD-DATE"],
      ["8420", "120,00"],
      ["8431", "99999999"], // present but not a real calendar date
    ]);
    // No wall-clock fallback for revenue: the invoice is skipped entirely.
    expect(events.find((e) => e.kind === "InvoicePaid")).toBeUndefined();
    // The non-revenue events still emit.
    expect(events.find((e) => e.kind === "PatientUpserted")).toBeDefined();
  });
});

describe("normalize: FK 6228 dual-use disambiguation (M-P8)", () => {
  const MTIME = "2026-07-19T08:30:00.000Z";

  it("a non-date 6228 is a Bemerkung, not a Zahldatum: invoice keeps the mtime fallback", async () => {
    const events = await canonicalWithMtime(
      [
        ["8000", "8316"],
        ["3000", "PAT-1"],
        ["6225", "RECH-1"],
        ["8420", "120,00"],
        ["6228", "EINS-Lead-abcd1234"], // free-text remark, not a date
      ],
      MTIME
    );
    const invoice = events.find((e) => e.kind === "InvoicePaid");
    expect(invoice).toBeDefined();
    // Date-less (6228 is not a date) -> deterministic mtime, never the wall clock.
    expect(invoice!.paidAt).toBe(MTIME);
    // The remark reaches bemerkung on the patient event.
    const patient = events.find((e) => e.kind === "PatientUpserted");
    expect(patient!.bemerkung).toContain("EINS-Lead-abcd1234");
  });

  it("a strict-date 6228 is the Zahldatum ONLY, never also a Bemerkung", async () => {
    const events = await canonicalWithMtime(
      [
        ["8000", "8316"],
        ["3000", "PAT-1"],
        ["6225", "RECH-2"],
        ["8420", "120,00"],
        ["6228", "19052026"], // strict date
      ],
      MTIME
    );
    const invoice = events.find((e) => e.kind === "InvoicePaid");
    expect(invoice!.paidAt).toBe("2026-05-19T00:00:00.000Z");
    // The same value must NOT also leak into bemerkung.
    const patient = events.find((e) => e.kind === "PatientUpserted");
    expect(patient!.bemerkung).toBeUndefined();
  });
});

describe("normalize: email fan-out stays inside the patient block (M-P8)", () => {
  it("does not capture a Praxis email from a non-patient (0xxx) field", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["0106", "praxis@praxis.example"], // Praxis/header range, not the patient
    ]);
    expect(events[0].email).toBeUndefined();
  });

  it("still recovers a patient email from an undocumented 3xxx field", async () => {
    const events = await canonical([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3799", "patient@example.com"], // undocumented patient-block contact FK
    ]);
    expect(events[0].email).toBe("patient@example.com");
  });
});

describe("normalize: deterministic occurredAt (H4 duplicate ingestion)", () => {
  const MTIME = "2026-07-19T08:30:00.000Z";

  it("a date-less patient export is byte-identical when re-parsed at a different wall-clock time (same ctx)", async () => {
    const lines: Array<[string, string]> = [
      ["8000", "6301"],
      ["3000", "PAT-42"],
      ["3101", "Müller"],
      ["3102", "Maria"],
    ];
    const first = await canonicalWithMtime(lines, MTIME);
    // Move the wall clock forward between the two parses; a wall-clock
    // occurredAt would diverge here and re-insert a duplicate row.
    const realNow = Date.now;
    Date.now = () => realNow() + 3_600_000;
    try {
      const second = await canonicalWithMtime(lines, MTIME);
      expect(second).toEqual(first);
    } finally {
      Date.now = realNow;
    }
    // The patient event has no business date, so occurredAt is the file mtime.
    expect(first[0].kind).toBe("PatientUpserted");
    expect(first[0].occurredAt).toBe(MTIME);
  });

  it("prefers a business date over the file mtime for the patient event (8316 with Befunddatum)", async () => {
    const events = await canonicalWithMtime(
      [
        ["8000", "8316"],
        ["3000", "PAT-1"],
        ["6200", "19052026"],
        ["8410", "GOÄ-2382"],
      ],
      MTIME
    );
    const patient = events.find((e) => e.kind === "PatientUpserted");
    const encounter = events.find((e) => e.kind === "EncounterCompleted");
    // Both derive from FK 6200, NOT the mtime.
    expect(patient!.occurredAt).toBe("2026-05-19T00:00:00.000Z");
    expect(encounter!.occurredAt).toBe("2026-05-19T00:00:00.000Z");
  });

  it("date-less encounter falls back to the file mtime, not the wall clock", async () => {
    const events = await canonicalWithMtime(
      [
        ["8000", "8316"],
        ["3000", "PAT-1"],
        ["8410", "GOÄ-1"],
      ],
      MTIME
    );
    const encounter = events.find((e) => e.kind === "EncounterCompleted");
    expect(encounter!.occurredAt).toBe(MTIME);
  });

  it("date-less invoice falls back to the file mtime for paidAt", async () => {
    const events = await canonicalWithMtime(
      [
        ["8000", "8316"],
        ["3000", "PAT-1"],
        ["6225", "RECH-NO-DATE"],
        ["8420", "120,00"],
      ],
      MTIME
    );
    const invoice = events.find((e) => e.kind === "InvoicePaid");
    expect(invoice!.occurredAt).toBe(MTIME);
    expect(invoice!.paidAt).toBe(MTIME);
  });

  it("without ctx.fileModifiedAtIso, the previous fallback still yields a valid ISO occurredAt", async () => {
    const events = await canonicalWithMtime(
      [
        ["8000", "6301"],
        ["3000", "PAT-42"],
      ],
      undefined
    );
    expect(events).toHaveLength(1);
    // A real ISO-8601 timestamp (wall-clock fallback), not undefined/empty.
    expect(events[0].occurredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});
