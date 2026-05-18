import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv-parser.js";

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
