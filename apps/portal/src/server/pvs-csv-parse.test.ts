import { describe, expect, it } from "vitest";
import {
  decodeCsvBytes,
  detectDelimiter,
  parseCsvBuffer,
} from "./pvs-csv-parse";

/** Encode as windows-1252 for the characters these fixtures need. */
function cp1252(text: string): Buffer {
  const map: Record<string, number> = {
    "ä": 0xe4, "ö": 0xf6, "ü": 0xfc, "Ä": 0xc4, "Ö": 0xd6, "Ü": 0xdc,
    "ß": 0xdf, "€": 0x80,
  };
  return Buffer.from([...text].map((c) => map[c] ?? c.charCodeAt(0)));
}

const GERMAN =
  "Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\r\n" +
  "P-1;R-100;350,00;07.10.2026\r\n" +
  "P-2;R-101;1.234,50;25.10.2026\r\n";

describe("pvs-csv-parse", () => {
  it("detects the semicolon of a standard German export and keeps 350,00 intact", () => {
    const r = parseCsvBuffer(Buffer.from(GERMAN, "utf8"));
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual(["Pat.-Nr.", "Rechnungsnummer", "Betrag", "Zahldatum"]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.Betrag).toBe("350,00");
    expect(r.rows[1]!.Betrag).toBe("1.234,50");
  });

  it("decodes CP1252 bytes instead of producing replacement characters", () => {
    const buf = cp1252("Pat.-Nr.;Name;Betrag;Zahldatum\r\nP-1;Müller Größe;12,00 €;01.10.2026\r\n");
    const r = parseCsvBuffer(buf);
    expect(r.encoding).toBe("windows-1252");
    expect(r.rows[0]!.Name).toBe("Müller Größe");
    expect(r.rows[0]!.Betrag).toBe("12,00 €");
    expect(JSON.stringify(r.rows)).not.toContain("�");
  });

  it("strips a UTF-8 BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(GERMAN, "utf8")]);
    const r = parseCsvBuffer(buf);
    expect(r.encoding).toBe("utf-8-bom");
    expect(r.headers[0]).toBe("Pat.-Nr.");
  });

  it("decodes UTF-16 LE with BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(GERMAN, "utf16le")]);
    const r = parseCsvBuffer(buf);
    expect(r.encoding).toBe("utf-16le");
    expect(r.rows).toHaveLength(2);
  });

  it("keeps valid UTF-8 umlauts as UTF-8", () => {
    expect(decodeCsvBytes(Buffer.from("Müller", "utf8")).encoding).toBe("utf-8");
  });

  it("skips a title line and finds the header row", () => {
    const r = parseCsvBuffer(
      Buffer.from("Honorarumsatz Oktober 2026;;;\r\n\r\n" + GERMAN, "utf8")
    );
    expect(r.headerRowNumber).toBe(2);
    expect(r.skippedPreambleLines).toBe(1);
    expect(r.headers).toContain("Rechnungsnummer");
    expect(r.rows).toHaveLength(2);
  });

  it("honours and drops a leading sep= line", () => {
    const r = parseCsvBuffer(Buffer.from("sep=;\r\n" + GERMAN, "utf8"));
    expect(r.delimiter).toBe(";");
    expect(r.headers[0]).toBe("Pat.-Nr.");
  });

  it("ignores a Summe footer line", () => {
    const r = parseCsvBuffer(Buffer.from(GERMAN + "Summe;;1.584,50;\r\n", "utf8"));
    expect(r.rows).toHaveLength(2);
    expect(r.skippedFooterLines).toBe(1);
  });

  it("detects tab and ignores delimiters inside quotes", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    const r = parseCsvBuffer(
      Buffer.from('Pat.-Nr.;Rechnungsnummer;Name\nP-1;R-1;"Meier, Anna; Dr."\n', "utf8")
    );
    expect(r.delimiter).toBe(";");
    expect(r.rows[0]!.Name).toBe("Meier, Anna; Dr.");
  });

  it("still parses comma files", () => {
    const r = parseCsvBuffer(
      Buffer.from("patientid,rechnungsnummer,betrag,datum\nP1,R1,350.00,2026-10-07\n", "utf8")
    );
    expect(r.delimiter).toBe(",");
    expect(r.rows[0]!.betrag).toBe("350.00");
  });

  it("rejects an empty file", () => {
    expect(() => parseCsvBuffer(Buffer.from("\r\n\r\n"))).toThrow("csv_empty");
  });
});
