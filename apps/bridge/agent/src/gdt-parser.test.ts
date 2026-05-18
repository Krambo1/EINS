import { describe, it, expect } from "vitest";
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
