import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { parseGdtFile, pickFirst } from "./gdt-parser";

/**
 * Parser fixture coverage. Real-world Praxis GDT files are CRLF-line-
 * oriented ISO-8859-1. We assemble fixtures inline rather than relying
 * on test data files to keep the agent build self-contained.
 */

function gdt(lines: Array<[string, string]>): Buffer {
  // Each line: LLLFFFFvalue\r\n where LLL = total line length INCLUDING \r\n.
  let body = "";
  for (const [fk, value] of lines) {
    const payload = `${fk}${value}`;
    const total = 3 + payload.length + 2; // 3 length chars + payload + CRLF
    body += `${String(total).padStart(3, "0")}${payload}\r\n`;
  }
  return Buffer.from(body, "latin1");
}

/** Builds a GDT buffer where each value's bytes are supplied directly,
 * so we can exercise specific source encodings (UTF-8 / ISO-8859-15 /
 * CP1252) without going through a string roundtrip. */
function gdtBytes(records: Array<{ fk: string; valueBytes: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  for (const { fk, valueBytes } of records) {
    const fkBytes = Buffer.from(fk, "ascii");
    const len = 3 + fkBytes.length + valueBytes.length + 2;
    const lenBytes = Buffer.from(String(len).padStart(3, "0"), "ascii");
    parts.push(lenBytes, fkBytes, valueBytes, Buffer.from("\r\n", "ascii"));
  }
  return Buffer.concat(parts);
}

describe("gdt-parser", () => {
  it("parses a Satzart 6301 patient export", async () => {
    const bytes = gdt([
      ["8000", "6301"],
      ["3000", "PAT-42"],
      ["3101", "Müller"],
      ["3102", "Maria"],
      ["3103", "15061980"],
      ["3110", "2"],
    ]);
    const r = await parseGdtFile(bytes);
    expect(r.satzart).toBe("6301");
    expect(pickFirst(r.records, "3000")).toBe("PAT-42");
    expect(pickFirst(r.records, "3101")).toBe("Müller");
    expect(pickFirst(r.records, "3103")).toBe("15061980");
  });

  it("ignores lines with invalid field-id format", async () => {
    const bytes = gdt([
      ["8000", "8316"],
      ["3000", "PAT-1"],
    ]);
    // Append a malformed line manually.
    const blob = Buffer.concat([bytes, Buffer.from("XYZ\r\n", "latin1")]);
    const r = await parseGdtFile(blob);
    expect(r.records.length).toBe(2);
  });

  it("produces a stable content hash for identical inputs", async () => {
    const bytes = gdt([
      ["8000", "6301"],
      ["3000", "PAT-A"],
    ]);
    const a = await parseGdtFile(bytes);
    const b = await parseGdtFile(bytes);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("reports a missing final line terminator instead of throwing (watcher decides)", async () => {
    const complete = gdt([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3101", "Mustermann"],
    ]);
    const cut = complete.subarray(0, complete.length - 2); // drop final CR LF
    const parsed = await parseGdtFile(cut);
    expect(parsed.endsWithTerminator).toBe(false);
    expect(pickFirst(parsed.records, "3101")).toBe("Mustermann");
    expect((await parseGdtFile(complete)).endsWithTerminator).toBe(true);
  });

  it("segments a multi-Satz BDT batch at FK 8000 boundaries (C2)", async () => {
    const bytes = gdt([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3101", "Müller"],
      ["8000", "6301"],
      ["3000", "PAT-2"],
      ["3101", "Schmidt"],
      ["8000", "8316"],
      ["3000", "PAT-3"],
      ["8420", "120,00"],
    ]);
    const r = await parseGdtFile(bytes);
    expect(r.saetze).toHaveLength(3);
    expect(r.saetze.map((s) => s.satzart)).toEqual(["6301", "6301", "8316"]);
    expect(pickFirst(r.saetze[0].records, "3000")).toBe("PAT-1");
    expect(pickFirst(r.saetze[1].records, "3000")).toBe("PAT-2");
    expect(pickFirst(r.saetze[2].records, "8420")).toBe("120,00");
    // Back-compat: satzart still reports the FIRST Satz.
    expect(r.satzart).toBe("6301");
  });

  it("yields a single Satz for a plain GDT file", async () => {
    const bytes = gdt([
      ["8000", "6301"],
      ["3000", "PAT-42"],
    ]);
    const r = await parseGdtFile(bytes);
    expect(r.saetze).toHaveLength(1);
    expect(r.saetze[0].records).toHaveLength(2);
  });

  it("decodes ISO-8859-15 (umlauts via Latin-1 byte sequence)", async () => {
    const bytes = gdt([
      ["8000", "6301"],
      ["3101", "Müller-Strauß"],
    ]);
    const r = await parseGdtFile(bytes);
    const lastName = pickFirst(r.records, "3101");
    // Should NOT contain replacement characters.
    expect(lastName).not.toContain("�");
    expect(lastName?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("gdt-parser encoding probe", () => {
  it("recovers 'Jürgen Müller' from CP1252-encoded bytes", async () => {
    // 0xFC for ü, 0xDC for Ü: identical in CP1252 and ISO-8859-15.
    // We assert the text is correct; the encoding label may be either
    // 8859-15 (tie-break winner) or cp1252.
    const bytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3101", valueBytes: iconv.encode("Müller", "CP1252") },
      { fk: "3102", valueBytes: iconv.encode("Jürgen", "CP1252") },
    ]);
    const r = await parseGdtFile(bytes);
    expect(pickFirst(r.records, "3101")).toBe("Müller");
    expect(pickFirst(r.records, "3102")).toBe("Jürgen");
    expect(["iso-8859-15", "cp1252"]).toContain(r.encoding);
  });

  it("recovers 'Jürgen Müller' from ISO-8859-15-encoded bytes", async () => {
    const bytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3101", valueBytes: iconv.encode("Müller", "ISO-8859-15") },
      { fk: "3102", valueBytes: iconv.encode("Jürgen", "ISO-8859-15") },
    ]);
    const r = await parseGdtFile(bytes);
    expect(pickFirst(r.records, "3101")).toBe("Müller");
    expect(pickFirst(r.records, "3102")).toBe("Jürgen");
    // Bytes identical to CP1252 fixture above; tie-break picks 8859-15.
    expect(r.encoding).toBe("iso-8859-15");
  });

  it("recovers 'Jürgen Müller' from UTF-8-encoded bytes", async () => {
    const bytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3101", valueBytes: Buffer.from("Müller", "utf8") },
      { fk: "3102", valueBytes: Buffer.from("Jürgen", "utf8") },
    ]);
    const r = await parseGdtFile(bytes);
    expect(pickFirst(r.records, "3101")).toBe("Müller");
    expect(pickFirst(r.records, "3102")).toBe("Jürgen");
    expect(r.encoding).toBe("utf8");
  });

  it("distinguishes CP1252 from ISO-8859-15 via € (0x80 vs 0xA4)", async () => {
    // CP1252 encodes € as 0x80; ISO-8859-15 encodes € as 0xA4.
    // Both decoders see ü at 0xFC, so only the € position disambiguates.
    const cp1252Bytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3000", valueBytes: iconv.encode("Müsli für 5€", "CP1252") },
    ]);
    const r1 = await parseGdtFile(cp1252Bytes);
    expect(r1.encoding).toBe("cp1252");
    expect(pickFirst(r1.records, "3000")).toBe("Müsli für 5€");

    const isoBytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3000", valueBytes: iconv.encode("Müsli für 5€", "ISO-8859-15") },
    ]);
    const r2 = await parseGdtFile(isoBytes);
    expect(r2.encoding).toBe("iso-8859-15");
    expect(pickFirst(r2.records, "3000")).toBe("Müsli für 5€");
  });

  it("recovers 'Müsli für 5€' from UTF-8 bytes", async () => {
    const bytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3000", valueBytes: Buffer.from("Müsli für 5€", "utf8") },
    ]);
    const r = await parseGdtFile(bytes);
    expect(r.encoding).toBe("utf8");
    expect(pickFirst(r.records, "3000")).toBe("Müsli für 5€");
  });

  it("defaults pure-ASCII content to utf8 deterministically", async () => {
    const bytes = gdtBytes([
      { fk: "8000", valueBytes: Buffer.from("6301", "ascii") },
      { fk: "3101", valueBytes: Buffer.from("Mueller", "ascii") },
      { fk: "3102", valueBytes: Buffer.from("Juergen", "ascii") },
    ]);
    const r = await parseGdtFile(bytes);
    expect(r.encoding).toBe("utf8");
    expect(pickFirst(r.records, "3101")).toBe("Mueller");
    expect(pickFirst(r.records, "3102")).toBe("Juergen");
  });
});

describe("gdt-parser: LLL length-prefix validation (L6)", () => {
  it("does not flag a well-formed file", async () => {
    const bytes = gdt([
      ["8000", "6301"],
      ["3000", "PAT-1"],
      ["3101", "Müller"],
    ]);
    const r = await parseGdtFile(bytes);
    expect(r.suspectLineCount).toBe(0);
  });

  it("drops a line whose LLL claims MORE bytes than present and counts it", async () => {
    const valid = gdt([
      ["8000", "6301"],
      ["3000", "PAT-1"],
    ]);
    // Hand-crafted line: LLL="020" claims a 20-byte line, but the line holds
    // "0203101Mueller" (14 bytes) + CR LF (2) = 16. It is the torn/truncated
    // signature: a length header written for a value the exporter never
    // finished. The FK 3101 is otherwise valid, so the OLD parser would have
    // emitted "Mueller" as a silently truncated record.
    const lying = Buffer.from("0203101Mueller\r\n", "latin1");
    const r = await parseGdtFile(Buffer.concat([valid, lying]));
    // The valid records survive; the lying line is dropped, not emitted.
    expect(pickFirst(r.records, "3000")).toBe("PAT-1");
    expect(pickFirst(r.records, "3101")).toBeUndefined();
    expect(r.suspectLineCount).toBe(1);
  });

  it("does not flag lines that are LONGER than claimed (padding / no-CRLF convention)", async () => {
    // LLL="010" but the line is longer than 10 bytes; byteLen + 2 >= claimed,
    // so this is NOT truncation and must not be flagged.
    const line = Buffer.from("0103101Mueller\r\n", "latin1");
    const r = await parseGdtFile(line);
    expect(r.suspectLineCount).toBe(0);
    expect(pickFirst(r.records, "3101")).toBe("Mueller");
  });
});

/**
 * Spec-grounded fixtures. GDT V2.1 (QMS, 5/01) section 2.6.2 prints this
 * exact "Stammdaten übermitteln" file; FK 8100 declares 173 bytes, which is
 * the real byte length of the Satz incl. every CR LF.
 */
const SPEC_6301_LINES = [
  "01380006301",
  "014810000173",
  "0178315EKG_TYP1",
  "0178316PRAX_EDV",
  "014921802.10",
  "014300002345",
  "0193101Mustermann",
  "0143102Franz",
  "017310301101945",
  "01031101",
  "0123622178",
  "0123623079",
];

describe("gdt-parser: GDT 2.1 spec example file", () => {
  it("parses the spec's 6301 example and verifies FK 8100 against the real byte length", async () => {
    const bytes = Buffer.from(SPEC_6301_LINES.map((l) => `${l}\r\n`).join(""), "latin1");
    expect(bytes.length).toBe(173);
    const parsed = await parseGdtFile(bytes);
    expect(parsed.saetze).toHaveLength(1);
    const s = parsed.saetze[0];
    expect(s.satzart).toBe("6301");
    expect(s.declaredLength).toBe(173);
    expect(s.actualLength).toBe(173);
    expect(s.lengthVerified).toBe(true);
    expect(pickFirst(s.records, "8315")).toBe("EKG_TYP1");
    expect(pickFirst(s.records, "3000")).toBe("02345");
    expect(pickFirst(s.records, "3103")).toBe("01101945");
    expect(parsed.suspectLineCount).toBe(0);
  });

  it("still verifies FK 8100 when the exporter omitted the final CR LF", async () => {
    const text = SPEC_6301_LINES.map((l) => `${l}\r\n`).join("");
    const parsed = await parseGdtFile(Buffer.from(text.slice(0, -2), "latin1"));
    expect(parsed.endsWithTerminator).toBe(false);
    // 171 actual bytes vs 173 declared: not verified, the watcher waits for
    // stability before accepting it.
    expect(parsed.saetze[0].lengthVerified).toBe(false);
  });
});

describe("gdt-parser: character sets per FK 9206", () => {
  function satzWithName(nameBytes: Buffer, decl?: string): Buffer {
    const recs: Array<{ fk: string; valueBytes: Buffer }> = [
      { fk: "8000", valueBytes: Buffer.from("6301") },
    ];
    if (decl) recs.push({ fk: "9206", valueBytes: Buffer.from(decl) });
    recs.push(
      { fk: "3000", valueBytes: Buffer.from("4711") },
      { fk: "3101", valueBytes: nameBytes },
      { fk: "3102", valueBytes: Buffer.from("Jürgen".replace("ü", "u")) }
    );
    return gdtBytes(recs);
  }

  it("decodes CP437 (the GDT standard charset, 9206=2)", async () => {
    const parsed = await parseGdtFile(satzWithName(iconv.encode("Müller-Weiß", "cp437"), "2"));
    expect(parsed.encoding).toBe("cp437");
    expect(pickFirst(parsed.records, "3101")).toBe("Müller-Weiß");
  });

  it("decodes CP437 even when 9206 is absent", async () => {
    const parsed = await parseGdtFile(satzWithName(iconv.encode("Jäger Öztürk", "cp437")));
    expect(pickFirst(parsed.records, "3101")).toBe("Jäger Öztürk");
  });

  it("decodes 7-bit DIN 66003 (9206=1): M}ller -> Müller, Stra~e -> Straße", async () => {
    const parsed = await parseGdtFile(satzWithName(Buffer.from("M}ller-Stra~e", "ascii"), "1"));
    expect(parsed.encoding).toBe("din66003");
    expect(pickFirst(parsed.records, "3101")).toBe("Müller-Straße");
  });

  it("decodes 9206=3 (ISO-8859-1/CP1252) content", async () => {
    const parsed = await parseGdtFile(satzWithName(iconv.encode("Müller", "cp1252"), "3"));
    expect(pickFirst(parsed.records, "3101")).toBe("Müller");
  });

  it("trusts the content over a wrong 9206 declaration (declares CP437, writes CP1252)", async () => {
    const parsed = await parseGdtFile(satzWithName(iconv.encode("Müller-Weiß", "cp1252"), "2"));
    expect(pickFirst(parsed.records, "3101")).toBe("Müller-Weiß");
    expect(parsed.declaredEncoding).toBe("cp437");
  });

  it("decodes UTF-8 written by modern PVS", async () => {
    const parsed = await parseGdtFile(satzWithName(Buffer.from("Müller-Weiß", "utf8")));
    expect(parsed.encoding).toBe("utf8");
    expect(pickFirst(parsed.records, "3101")).toBe("Müller-Weiß");
  });
});
