import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { parseCsv, CsvFileTooLargeError } from "./csv-parser.js";

describe("csv-parser", () => {
  it("parses a semicolon-delimited medatixx Honorar export", () => {
    const text =
      "Patient-Nr.;Rechnungs-Nr.;Betrag;Bezahldatum\r\n" +
      "PAT-1;RECH-100;350,00;19.05.2026\r\n" +
      "PAT-2;RECH-101;1.250,00;19.05.2026\r\n";
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual([
      "Patient-Nr.",
      "Rechnungs-Nr.",
      "Betrag",
      "Bezahldatum",
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]).toEqual({
      "Patient-Nr.": "PAT-2",
      "Rechnungs-Nr.": "RECH-101",
      Betrag: "1.250,00",
      Bezahldatum: "19.05.2026",
    });
  });

  it("handles quoted fields with embedded delimiters", () => {
    const text =
      "Patient;Bemerkung;Betrag\r\n" +
      'PAT-1;"Müller, Maria";150,00\r\n';
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.rows[0]).toEqual({
      Patient: "PAT-1",
      Bemerkung: "Müller, Maria",
      Betrag: "150,00",
    });
  });

  it("strips UTF-8 BOM", () => {
    const text = "﻿Patient;Betrag\nPAT-1;100,00\n";
    const r = parseCsv(Buffer.from(text, "utf8"));
    expect(r.headers[0]).toBe("Patient");
  });

  it("decodes ISO-8859-15 when UTF-8 yields replacement chars", () => {
    // Build a Latin-1 byte sequence: "Müller" can't roundtrip cleanly via
    // utf8 decode of latin1 bytes — should fall back to ISO decode.
    const bytes = Buffer.from("Patient\nMüller\n", "latin1");
    const r = parseCsv(bytes);
    expect(r.rows[0].Patient).toBe("Müller");
  });

  it("auto-detects comma delimiter when no semicolons present", () => {
    const text = "a,b,c\n1,2,3\n";
    const r = parseCsv(Buffer.from(text, "utf8"));
    expect(r.delimiter).toBe(",");
    expect(r.rows[0]).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("returns a stable content hash for identical inputs", () => {
    const bytes = Buffer.from("a;b\n1;2\n");
    const a = parseCsv(bytes);
    const b = parseCsv(bytes);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("handles escaped quotes (\"\") inside quoted fields", () => {
    const text = 'a;b\n"foo""bar";baz\n';
    const r = parseCsv(Buffer.from(text, "utf8"));
    expect(r.rows[0].a).toBe('foo"bar');
  });
});

describe("csv-parser: multi-line quoted fields (H9)", () => {
  it("keeps a quoted field containing a newline as ONE row with correct columns", () => {
    const text =
      "Patient-Nr.;Bemerkung;Betrag\r\n" +
      'PAT-1;"Zeile eins\nZeile zwei";150,00\r\n' +
      "PAT-2;kurz;200,00\r\n";
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      "Patient-Nr.": "PAT-1",
      Bemerkung: "Zeile eins\nZeile zwei",
      Betrag: "150,00",
    });
    // The row AFTER the multi-line cell must not be shifted into wrong columns.
    expect(r.rows[1]).toEqual({
      "Patient-Nr.": "PAT-2",
      Bemerkung: "kurz",
      Betrag: "200,00",
    });
    expect(r.droppedSuspectLastRow).toBe(false);
  });

  it("handles a quoted field spanning several newlines and an embedded delimiter", () => {
    const text =
      "Patient-Nr.;Bemerkung;Betrag\r\n" +
      'PAT-1;"a\nb;c\nd";99,00\r\n';
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].Bemerkung).toBe("a\nb;c\nd");
    expect(r.rows[0].Betrag).toBe("99,00");
  });

  it("treats an unbalanced trailing quote as a torn write: drops it loudly", () => {
    // The last row opens a quote that never closes (a half-written export).
    const text =
      "Patient-Nr.;Bemerkung;Betrag\r\n" +
      "PAT-1;ok;150,00\r\n" +
      'PAT-2;"noch nicht fertig';
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]["Patient-Nr."]).toBe("PAT-1");
    expect(r.droppedSuspectLastRow).toBe(true);
  });
});

describe("csv-parser: torn-write guard (reliability review C1)", () => {
  it("drops the last row and flags it when the file has no final newline", () => {
    // A write paused mid-line: the last physical line is a truncated row
    // that would otherwise parse as a valid row with a wrong amount.
    const text =
      "Patient-Nr.;Rechnungs-Nr.;Betrag\r\n" +
      "PAT-1;RECH-100;350,00\r\n" +
      "PAT-2;RECH-101;1.2"; // torn mid-amount, no CRLF
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]["Rechnungs-Nr."]).toBe("RECH-100");
    expect(r.droppedSuspectLastRow).toBe(true);
  });

  it("keeps every row and does not flag when the file ends with a newline", () => {
    const text =
      "Patient-Nr.;Betrag\r\n" + "PAT-1;350,00\r\n" + "PAT-2;125,00\r\n";
    const r = parseCsv(Buffer.from(text, "latin1"));
    expect(r.rows).toHaveLength(2);
    expect(r.droppedSuspectLastRow).toBe(false);
  });

  it("does not flag a header-only file without a final newline", () => {
    const r = parseCsv(Buffer.from("Patient-Nr.;Betrag", "latin1"));
    expect(r.rows).toHaveLength(0);
    expect(r.droppedSuspectLastRow).toBe(false);
  });

  it("does not flag when the newline-less tail is only whitespace", () => {
    const text = "a;b\r\n1;2\r\n   ";
    const r = parseCsv(Buffer.from(text, "utf8"));
    expect(r.rows).toHaveLength(1);
    expect(r.droppedSuspectLastRow).toBe(false);
  });
});

describe("csv-parser: encoding / BOM handling (L3)", () => {
  const CSV = "Patient;Betrag\r\nPAT-1;100,00\r\n";

  it("decodes a UTF-16LE file with BOM (Excel 'Unicode Text' export)", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      iconv.encode(CSV, "utf16-le"),
    ]);
    const r = parseCsv(bytes);
    expect(r.headers).toEqual(["Patient", "Betrag"]);
    expect(r.rows[0]).toEqual({ Patient: "PAT-1", Betrag: "100,00" });
  });

  it("decodes a UTF-16BE file with BOM", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      iconv.encode(CSV, "utf16-be"),
    ]);
    const r = parseCsv(bytes);
    expect(r.headers).toEqual(["Patient", "Betrag"]);
    expect(r.rows[0]).toEqual({ Patient: "PAT-1", Betrag: "100,00" });
  });

  it("preserves umlauts in a UTF-16LE body", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      iconv.encode("Name;Ort\r\nMüller;Köln\r\n", "utf16-le"),
    ]);
    const r = parseCsv(bytes);
    expect(r.headers[0]).toBe("Name");
    expect(r.rows[0]).toEqual({ Name: "Müller", Ort: "Köln" });
  });

  it("keeps the first header clean when a UTF-8 BOM sits over a Latin-1 body", () => {
    // Real medatixx quirk: a UTF-8 BOM prefix but the body is ISO-8859-15.
    // Without stripping the BOM bytes first, the fallback decode leaves a
    // "ï»¿" mojibake prefix glued to the first header, breaking header matching.
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("Patient;Bemerkung\r\nPAT-1;Müller\r\n", "latin1"),
    ]);
    const r = parseCsv(bytes);
    expect(r.headers).toEqual(["Patient", "Bemerkung"]);
    expect(r.rows[0]).toEqual({ Patient: "PAT-1", Bemerkung: "Müller" });
  });
});

describe("csv-parser: zero-byte / empty file (L4)", () => {
  it("returns empty headers (no crash) for a zero-byte file", () => {
    const r = parseCsv(Buffer.alloc(0));
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.droppedSuspectLastRow).toBe(false);
  });

  it("returns empty headers for a BOM-only file", () => {
    const r = parseCsv(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
  });
});

describe("csv-parser: 3-candidate scored decode (M-P1)", () => {
  it("decodes a CP1252 euro sign (0x80) that ISO-8859-15 would mangle", () => {
    // 0x80 is the CP1252 code for € but a C1 control char in ISO-8859-15.
    // The old utf8-or-ISO fallback had no CP1252 candidate, so this byte was
    // never recoverable as €; the scored probe now picks CP1252.
    const bytes = Buffer.concat([
      Buffer.from("Betrag\n", "latin1"),
      Buffer.from([0x80]),
      Buffer.from("100\n", "latin1"),
    ]);
    const r = parseCsv(bytes);
    expect(r.headers).toEqual(["Betrag"]);
    expect(r.rows[0].Betrag).toBe("€100");
  });

  it("recovers a Latin-1 umlaut name that decoded as UTF-8 would corrupt", () => {
    // 0xFC ("ü") is a lone invalid byte under UTF-8 (→ U+FFFD). The scored
    // probe picks an 8-bit candidate that yields the real name instead of
    // silently ingesting mojibake.
    const bytes = Buffer.from("Name\nJürgen Müller\n", "latin1");
    const r = parseCsv(bytes);
    expect(r.rows[0].Name).toBe("Jürgen Müller");
  });
});

describe("csv-parser: count-based delimiter detection (M-P2)", () => {
  it("picks the MOST FREQUENT delimiter, not merely a present one", () => {
    // Tab-separated header with a single stray semicolon. Presence-based
    // detection wrongly chose ';'; count-based chooses tab (4 > 1).
    const text = "a\tb\tc\td;e\r\n1\t2\t3\t4;5\r\n";
    const r = parseCsv(Buffer.from(text, "utf8"));
    expect(r.delimiter).toBe("\t");
    expect(r.headers).toEqual(["a", "b", "c", "d;e"]);
  });

  it("breaks a genuine tie in the order ; > tab > ,", () => {
    // One of each: semicolon wins the tie (German-PVS default).
    const r = parseCsv(Buffer.from("a;b\tc,d\r\n1;2\t3,4\r\n", "utf8"));
    expect(r.delimiter).toBe(";");
  });
});

describe("csv-parser: ragged rows + duplicate headers (M-P3)", () => {
  it("counts ragged rows (too few / too many cells) without dropping them", () => {
    const text =
      "a;b;c\r\n" +
      "1;2;3\r\n" + // well-formed
      "1;2\r\n" + // missing a cell
      "1;2;3;4\r\n"; // extra cell
    const r = parseCsv(Buffer.from(text, "utf8"));
    expect(r.rows).toHaveLength(3);
    expect(r.raggedRowCount).toBe(2);
    // Tolerant behaviour preserved: missing cell blanked, extra cell dropped.
    expect(r.rows[1]).toEqual({ a: "1", b: "2", c: "" });
    expect(r.rows[2]).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("reports duplicate header names", () => {
    const r = parseCsv(Buffer.from("Betrag;Datum;Betrag\r\n1;x;2\r\n", "utf8"));
    expect(r.duplicateHeaders).toEqual(["Betrag"]);
  });

  it("reports no duplicates for a clean header", () => {
    const r = parseCsv(Buffer.from("a;b;c\r\n1;2;3\r\n", "utf8"));
    expect(r.duplicateHeaders).toEqual([]);
    expect(r.raggedRowCount).toBe(0);
  });
});

describe("csv-parser: parse-time caps (M-P9)", () => {
  it("stops early and flags rowCapExceeded when maxRows is reached", () => {
    const rows = Array.from({ length: 10 }, (_, i) => `PAT-${i};${i}`).join(
      "\r\n"
    );
    const text = "Patient;Betrag\r\n" + rows + "\r\n";
    const r = parseCsv(Buffer.from(text, "utf8"), { maxRows: 3 });
    expect(r.rowCapExceeded).toBe(true);
    // Allocation stopped at the cap rather than building all ten rows.
    expect(r.rows).toHaveLength(3);
  });

  it("does not flag rowCapExceeded when the row count is exactly at the cap", () => {
    const text = "Patient;Betrag\r\nPAT-0;0\r\nPAT-1;1\r\nPAT-2;2\r\n";
    const r = parseCsv(Buffer.from(text, "utf8"), { maxRows: 3 });
    expect(r.rowCapExceeded).toBe(false);
    expect(r.rows).toHaveLength(3);
  });

  it("throws CsvFileTooLargeError before decoding when maxBytes is exceeded", () => {
    const bytes = Buffer.from("a;b\r\n1;2\r\n", "utf8");
    expect(() => parseCsv(bytes, { maxBytes: 4 })).toThrow(CsvFileTooLargeError);
  });

  it("parses normally when under the byte cap", () => {
    const bytes = Buffer.from("a;b\r\n1;2\r\n", "utf8");
    const r = parseCsv(bytes, { maxBytes: 1024 });
    expect(r.rows[0]).toEqual({ a: "1", b: "2" });
  });
});
