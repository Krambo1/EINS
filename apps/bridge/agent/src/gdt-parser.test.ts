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
