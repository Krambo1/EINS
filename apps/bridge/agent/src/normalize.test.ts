import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { parseGdtFile } from "./gdt-parser.js";
import { gdtToCanonical, type CanonicalEvent } from "./normalize.js";

/**
 * GDT → canonical translation, with fixtures shaped like what a PVS really
 * writes to a GDT "device" (GDT 2.1 spec, QMS; CGM Turbomed and PADSY docs):
 * Satzart 6301 / 6302 / 6311 with the patient block, CR LF lines, CP437 by
 * default. GDT carries NO billing data: FK 8420 is a measurement value.
 */

const CLINIC = "00000000-0000-0000-0000-000000000001";
const MTIME = "2026-10-07T08:15:00.000Z";

function gdt(lines: Array<[string, string]>, enc = "latin1"): Buffer {
  const parts: Buffer[] = [];
  for (const [fk, value] of lines) {
    const payload = Buffer.concat([Buffer.from(fk, "ascii"), iconv.encode(value, enc)]);
    const len = 3 + payload.length + 2;
    parts.push(Buffer.from(String(len).padStart(3, "0"), "ascii"), payload, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

async function translate(lines: Array<[string, string]>, enc = "latin1"): Promise<CanonicalEvent[]> {
  const parsed = await parseGdtFile(gdt(lines, enc));
  return gdtToCanonical(parsed, {
    clinicId: CLINIC,
    contentHash: parsed.contentHash,
    fileModifiedAtIso: MTIME,
  });
}

const HEADER: Array<[string, string]> = [
  ["8315", "EINS"],
  ["8316", "MEDATIXX"],
  ["9218", "02.10"],
];

describe("normalize: PVS → device Satzarten become PatientUpserted", () => {
  it("6301 Stammdaten übermitteln", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["8100", "00000"],
      ...HEADER,
      ["3000", "4711"],
      ["3101", "Müller"],
      ["3102", "Anna"],
      ["3103", "15061980"],
      ["3110", "2"],
      ["3622", "168"],
      ["3623", "61"],
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: "PatientUpserted",
      bridgeSource: "gdt_agent",
      clinicId: CLINIC,
      pvsPatientId: "4711",
      fullName: "Anna Müller",
      dob: "1980-06-15",
      gender: "f",
      occurredAt: MTIME,
    });
    // Height/weight never leak into the payload.
    expect(JSON.stringify(ev[0])).not.toMatch(/168|"61"/);
    expect(ev[0].bemerkung).toBeUndefined();
  });

  it("6302 Neue Untersuchung anfordern (Turbomed sends this whenever 8402 is set)", async () => {
    const ev = await translate([
      ["8000", "6302"],
      ...HEADER,
      ["3000", "4711"],
      ["3101", "Müller"],
      ["3102", "Anna"],
      ["3103", "15061980"],
      ["8402", "ALLG00"],
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "PatientUpserted", pvsPatientId: "4711" });
  });

  it("6311 Daten einer Untersuchung zeigen", async () => {
    const ev = await translate([
      ["8000", "6311"],
      ["3000", "4711"],
      ["3101", "Müller"],
      ["6200", "07102026"],
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["PatientUpserted"]);
  });

  it("BDT 6100 Patientenstamm", async () => {
    const ev = await translate([
      ["8000", "6100"],
      ["3000", "12"],
      ["3101", "Schmidt"],
      ["3102", "Erna"],
      ["3626", "0221 123456"],
    ]);
    expect(ev[0]).toMatchObject({ kind: "PatientUpserted", phone: "0221 123456" });
  });

  it("device → PVS Satzarten (6300, 6310) and unknown ones yield nothing", async () => {
    for (const sa of ["6300", "6310", "8316", "0020", "6200"]) {
      const ev = await translate([
        ["8000", sa],
        ["3000", "4711"],
        ["3101", "Müller"],
      ]);
      expect(ev, `satzart ${sa}`).toEqual([]);
    }
  });
});

describe("normalize: GDT has no billing data", () => {
  it("a 6310 with FK 8420 measurement values never becomes revenue", async () => {
    const ev = await translate([
      ["8000", "6310"],
      ["3000", "4711"],
      ["8410", "RRSYS"],
      ["8411", "Blutdruck systolisch"],
      ["8420", "120"],
      ["8421", "mmHg"],
    ]);
    expect(ev).toEqual([]);
  });

  it("a 6301 carrying stray 8420/6225/6228 lines still emits only the patient", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "4711"],
      ["3101", "Müller"],
      ["6225", "R-1"],
      ["6228", "07102026"],
      ["8420", "350,00"],
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["PatientUpserted"]);
    expect(ev.some((e) => e.kind === "InvoicePaid" || e.kind === "InvoiceRefunded")).toBe(false);
  });
});

describe("normalize: patient fields", () => {
  it("includes the Namenszusatz, excludes the Titel", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
      ["3100", "von"],
      ["3101", "Stein"],
      ["3102", "Clara"],
      ["3104", "Dr."],
    ]);
    expect(ev[0].fullName).toBe("Clara von Stein");
  });

  it("GDT 3.x contact fields: 3619 E-Mail, 3618 Mobil preferred over 3626 Telefon", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
      ["3626", "0221 999999"],
      ["3618", "+49 171 1234567"],
      ["3619", "Anna.Mueller@Example.de"],
    ]);
    expect(ev[0]).toMatchObject({ phone: "+49 171 1234567", email: "anna.mueller@example.de" });
  });

  it("does not misread 3628 (Muttersprache) as a phone or email", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
      ["3628", "türkisch"],
    ]);
    expect(ev[0].phone).toBeUndefined();
    expect(ev[0].email).toBeUndefined();
  });

  it("does not capture a Praxis address from a non-patient field", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
      ["0201", "praxis@example.de"],
    ]);
    expect(ev[0].email).toBeUndefined();
  });

  it("gender codes: 1=m, 2=w, GDT 3.x letters", async () => {
    const g = async (v: string) =>
      (await translate([["8000", "6301"], ["3000", "1"], ["3110", v]]))[0].gender;
    expect(await g("1")).toBe("m");
    expect(await g("2")).toBe("f");
    expect(await g("W")).toBe("f");
    expect(await g("D")).toBe("d");
    expect(await g("9")).toBeUndefined();
  });

  it("rejects impossible birth dates instead of shipping them", async () => {
    const dob = async (v: string) =>
      (await translate([["8000", "6301"], ["3000", "1"], ["3103", v]]))[0].dob;
    expect(await dob("31021980")).toBeUndefined();
    expect(await dob("00001970")).toBeUndefined();
    expect(await dob("29022024")).toBe("2024-02-29");
  });

  it("CP437 umlauts (the GDT default charset) arrive intact", async () => {
    const ev = await translate(
      [
        ["8000", "6301"],
        ["9206", "2"],
        ["3000", "1"],
        ["3101", "Größer"],
        ["3102", "Jürgen"],
      ],
      "cp437"
    );
    expect(ev[0].fullName).toBe("Jürgen Größer");
  });

  it("drops a Satz without FK 3000 instead of inventing a patient", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3101", "Müller"],
    ]);
    expect(ev).toEqual([]);
  });
});

describe("normalize: lead token", () => {
  it("forwards only the EINS lead token found in free text, never the text", async () => {
    const ev = await translate([
      ["8000", "6302"],
      ["3000", "1"],
      ["6220", "Beratung Lidstraffung, Anfrage über Website eins lead: 1A2B3C4D"],
      ["6227", "Allergie gegen Latex"],
    ]);
    expect(ev[0].bemerkung).toBe("EINS-Lead-1a2b3c4d");
  });

  it("ignores near-misses (9 hex digits)", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
      ["6227", "EINS-Lead-1a2b3c4d5"],
    ]);
    expect(ev[0].bemerkung).toBeUndefined();
  });
});

describe("normalize: several Sätze in one file (allowed by the spec, BDT always)", () => {
  it("one PatientUpserted per Satz with Satz-scoped ids", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
      ["3101", "A"],
      ["8000", "6301"],
      ["3000", "2"],
      ["3101", "B"],
      ["8000", "6310"],
      ["3000", "3"],
    ]);
    expect(ev.map((e) => e.pvsPatientId)).toEqual(["1", "2"]);
    expect(ev[0].pvsExternalEventId).toMatch(/:s0$/);
    expect(ev[1].pvsExternalEventId).toMatch(/:s1$/);
  });

  it("single-Satz files keep the historical id shape (no :s0 suffix)", async () => {
    const ev = await translate([
      ["8000", "6301"],
      ["3000", "1"],
    ]);
    expect(ev[0].pvsExternalEventId).toMatch(/^gdt:patient:1:[0-9a-f]{64}$/);
  });
});

describe("normalize: 7-bit DIN 66003 e-mail", () => {
  it("restores the @ that DIN 66003 decodes as §", async () => {
    // 0x40 in a 9206=1 file is "§"; the PVS still meant "@".
    const ev = await translate([
      ["8000", "6301"],
      ["9206", "1"],
      ["3000", "77"],
      ["3101", "M}ller"],
      ["3619", "anna.mueller@example.test"],
    ]);
    expect(ev[0].fullName).toBe("Müller");
    expect(ev[0].email).toBe("anna.mueller@example.test");
  });
});

describe("normalize: deterministic ids and times", () => {
  it("same bytes + same mtime → byte-identical events (crash replay dedups)", async () => {
    const lines: Array<[string, string]> = [
      ["8000", "6301"],
      ["3000", "1"],
      ["3101", "A"],
    ];
    expect(JSON.stringify(await translate(lines))).toBe(JSON.stringify(await translate(lines)));
  });

  it("falls back to one wall-clock stamp when no mtime is supplied", async () => {
    const parsed = await parseGdtFile(gdt([["8000", "6301"], ["3000", "1"]]));
    const ev = gdtToCanonical(parsed, { clinicId: CLINIC, contentHash: parsed.contentHash });
    expect(Number.isNaN(Date.parse(ev[0].occurredAt))).toBe(false);
  });
});
