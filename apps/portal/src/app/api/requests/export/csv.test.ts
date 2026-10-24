import { describe, expect, it } from "vitest";
import { buildCsv, csvCell } from "./csv";

describe("csvCell", () => {
  it("neutralises formula starts", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('=HYPERLINK("https://x.de";"Klick")')).toBe(
      `"'=HYPERLINK(""https://x.de"";""Klick"")"`
    );
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell("\t0170 1234567")).toBe("'\t0170 1234567");
  });

  it("writes phone numbers as text without an apostrophe", () => {
    expect(csvCell("+49 170 1234567")).toBe(`"=""+49 170 1234567"""`);
    expect(csvCell("+491701234567")).toBe(`"=""+491701234567"""`);
    expect(csvCell("+49-170-1234567")).toBe(`"=""+49-170-1234567"""`);
    expect(csvCell("01701234567")).toBe(`"=""01701234567"""`);
    expect(csvCell("-5")).toBe(`"=""-5"""`);
    expect(csvCell("0170 1234567")).toBe("0170 1234567");
    expect(csvCell("(0170) 123/4567")).toBe("(0170) 123/4567");
    for (const v of ["+49 170 1234567", "+491701234567", "0170 1234567", "-5"]) {
      expect(csvCell(v)).not.toContain("'");
    }
  });

  it("never guards real numbers", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(0)).toBe("0");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell("Müller; Anna")).toBe('"Müller; Anna"');
    expect(csvCell('Sagt "hallo"')).toBe('"Sagt ""hallo"""');
    expect(csvCell("Zeile 1\nZeile 2")).toBe('"Zeile 1\nZeile 2"');
  });

  it("leaves plain values alone and blanks null", () => {
    expect(csvCell("Botox")).toBe("Botox");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("buildCsv", () => {
  it("starts with a BOM, uses semicolons and CRLF", () => {
    const out = buildCsv(["Name", "Ort"], [["Anna", "Köln"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe("Name;Ort\r\nAnna;Köln\r\n");
  });
});
