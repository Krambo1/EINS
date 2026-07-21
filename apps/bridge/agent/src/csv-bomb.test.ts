import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv-parser.js";
import { mapCsvRow, type CsvMapping } from "./csv-mapper.js";
import { parseGdtFile } from "./gdt-parser.js";

/**
 * P3-1 / Sections 5 & 6 of pvs-redteam.md: CSV bomb + GDT bomb defences.
 *
 * These tests cover the parser-level invariants. The byte-size and
 * row-count guards in watcher.ts / csv-watcher.ts run BEFORE these
 * parsers ever see the file; the guards' behaviour is verified manually
 * in the staging-soak runbook (drop a 100 MB random-byte file and
 * confirm the agent memory stays flat; see
 * docs/runbooks/pvs-staging-soak.md).
 *
 * What we DO test here:
 *   1. parseCsv handles a moderate-but-still-large input (10k rows)
 *      without quadratic blow-up. A regression that makes parseCsv
 *      O(n²) would surface as a CI timeout, alerting before prod
 *      deployment.
 *   2. mapCsvRow does not execute formula-injection cells (`=cmd…`,
 *      `@SUM(…)`, etc.). Cells land as plain strings in event payloads.
 *      Cells targeting numeric columns (`amount`) fail the numeric
 *      parser and the row is skipped; no events for that row.
 *   3. parseGdtFile rejects a "length-lie" attack (a GDT line whose
 *      claimed length exceeds the actual buffer) without buffer
 *      overrun.
 */

describe("CSV bomb defences (P3-1 / Section 6)", () => {
  it("parseCsv handles 10,000 rows without quadratic blow-up", () => {
    // Construct a 10k-row CSV at runtime. ~600 KB of input; small
    // enough to keep the test fast, large enough to expose anything
    // accidentally O(n²) in the parser (5+ seconds in CI would fire
    // the default vitest timeout).
    const rowCount = 10_000;
    const header = "pvs_patient_id;rechnung_id;betrag;bezahldatum\r\n";
    const rows: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      rows.push(`PAT-${i};R-${i};250,00;19.05.2026`);
    }
    const csv = header + rows.join("\r\n") + "\r\n";
    const startMs = Date.now();
    const result = parseCsv(Buffer.from(csv, "latin1"));
    const elapsedMs = Date.now() - startMs;
    expect(result.rows.length).toBe(rowCount);
    expect(result.delimiter).toBe(";");
    // Sanity-check on per-row throughput: 10k rows in < 2s on a slow
    // CI box. A regression below that catches accidentally-O(n²)
    // parser changes (e.g. string concatenation inside the row loop).
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it("parseCsv handles 1MB of wide-row input without OOM", () => {
    // 1 KB-wide rows, 1024 rows = 1 MB of input. The point is that the
    // parser's intermediate allocations don't multiply this by the row
    // count (i.e. a regression that built a String per cell per row
    // via concatenation inside a hot loop would push allocation past
    // 1 GB and we'd see vitest fail).
    const header =
      Array.from({ length: 50 }, (_, i) => `col_${i}`).join(";") + "\r\n";
    const wideCell = "x".repeat(20); // 50 cols × 20 chars ≈ 1 KB per row.
    const row =
      Array.from({ length: 50 }, () => wideCell).join(";") + "\r\n";
    const csv = header + row.repeat(1024);
    expect(() =>
      parseCsv(Buffer.from(csv, "latin1"))
    ).not.toThrow();
  });

  it("formula-injection cells do not execute and do not crash the mapper", () => {
    // The most-cited CSV-injection payloads. None of these should
    // cause mapCsvRow to throw OR to produce an event whose stringified
    // form contains the literal payload re-formatted as code.
    const payloads = [
      "=cmd|'/c calc'!A0",
      "=2+5+cmd|'/c calc'!A0",
      "+SUM(1+2)*cmd|'/c calc'!A0",
      "@SUM(1+1)",
      "-2+3+cmd|'/c calc'!A0",
      "=HYPERLINK(\"http://evil.example\",\"click\")",
    ];

    const mapping: CsvMapping = {
      stream: "patients",
      columns: {
        pvsPatientId: "PatID",
        fullName: "Name",
        email: "Email",
        phone: "Phone",
        bemerkung: "Bemerk",
      },
      dateFormat: "DD.MM.YYYY",
    };

    for (const payload of payloads) {
      const result = mapCsvRow({
        clinicId: "00000000-0000-4000-8000-000000000001",
        fileHash: "test-hash",
        rowIndex: 1,
        row: {
          PatID: "P-1",
          Name: payload,
          Email: "ok@example.com",
          Phone: "017612345678",
          Bemerk: payload,
        },
        mapping,
      });
      // Two acceptable outcomes:
      //   (a) The row maps successfully and the payload lands as a plain
      //       string in the event. We then ASSERT no event property is
      //       a function / non-string code path.
      //   (b) The mapper rejects the row (e.g. an unrelated validation
      //       triggers). That is also safe.
      if (result.ok) {
        for (const event of result.events) {
          // Every payload-carrying field is a string, not a function
          // call or other typed-array. We're verifying the payload
          // didn't smuggle past the mapper as something other than a
          // plain string.
          if ("fullName" in event && event.fullName !== undefined) {
            expect(typeof event.fullName).toBe("string");
            // The payload is preserved verbatim; no implicit eval, no
            // sanitisation that would mask a bug.
            expect(event.fullName).toBe(payload);
          }
          if ("bemerkung" in event && event.bemerkung !== undefined) {
            expect(typeof event.bemerkung).toBe("string");
            expect(event.bemerkung).toBe(payload);
          }
        }
      }
    }
  });

  it("formula-injection in the amount column fails numeric parse and skips the row", () => {
    // The invoice stream's `amount` mapper has to convert a string to
    // cents. A `=cmd…` value must fail the parse and produce
    // `{ok: false}` rather than emitting an event with garbage amount.
    const mapping: CsvMapping = {
      stream: "invoices",
      columns: {
        pvsPatientId: "PatID",
        pvsInvoiceId: "RechID",
        amount: "Betrag",
        paidAt: "Bezahldatum",
      },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
    };
    const result = mapCsvRow({
      clinicId: "00000000-0000-4000-8000-000000000001",
      fileHash: "test-hash",
      rowIndex: 1,
      row: {
        PatID: "P-1",
        RechID: "R-1",
        Betrag: "=cmd|'/c calc'!A0",
        Bezahldatum: "19.05.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(false);
  });
});

describe("GDT bomb / length-lie defence (P3-1 / Section 5)", () => {
  it("a GDT line whose claimed length exceeds the buffer fails the parse without overrun", async () => {
    // Construct a GDT buffer where the line-length prefix is much
    // larger than the actual line bytes. The parser MUST NOT read past
    // the buffer (which would surface as either a real-world crash on
    // some platforms or as silent garbage on others).
    const realLine = "8000PAT-42\r\n"; // 12 bytes total
    const lyingPrefix = "999"; // claims a 999-byte line
    const tail = realLine.slice(3);
    const malformed = Buffer.from(lyingPrefix + tail, "latin1");
    // L6: the LLL prefix is now validated against the actual line bytes. A line
    // that claims 999 bytes but holds ~10 is treated as a truncated line: its
    // value is DROPPED (never emitted as a silently truncated record) and the
    // occurrence is counted on suspectLineCount so the parser + watcher can warn
    // loudly. The parse must not THROW unsafely (no RangeError buffer overrun).
    const result = await parseGdtFile(malformed).catch((err) => ({
      __error: true,
      err,
    }));
    expect("__error" in result).toBe(false);
    if ("__error" in result) return;
    // The lying line was detected and dropped, not accepted as a record.
    expect(result.suspectLineCount).toBeGreaterThanOrEqual(1);
    expect(result.records).toHaveLength(0);
  });

  it("binary garbage (image bytes pretending to be GDT) fails cleanly", async () => {
    // A PNG header followed by random bytes. The line-length parser
    // expects ASCII digits; PNG's binary header breaks the format
    // immediately. The result is either an empty parse or a clear
    // error; never a process-level crash.
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      // ... rest of the bytes are arbitrary garbage.
      ...Array.from({ length: 256 }, (_, i) => i & 0xff),
    ]);
    const result = await parseGdtFile(png).catch((err) => ({
      __error: true,
      err,
    }));
    if ("__error" in result) {
      expect(String(result.err)).not.toMatch(/RangeError/);
    } else {
      // If the parser tolerated the input, it must have produced zero
      // emittable records (nothing in PNG decodes as a valid GDT
      // Satzart).
      expect((result.records ?? []).length).toBe(0);
    }
  });
});
