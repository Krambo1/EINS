import { describe, expect, it } from "vitest";
import { parseGdtFile } from "./gdt-parser.js";
import { gdtToCanonical } from "./normalize.js";
import { mapCsvRow, type CsvMapping } from "./csv-mapper.js";

/**
 * H4 watcher wiring: watcher.ts / csv-watcher.ts derive the deterministic
 * occurredAt fallback from the source file's mtime via
 * `new Date(preStat.mtimeMs).toISOString()` and pass it as
 * `fileModifiedAtIso`. These tests exercise exactly that derivation +
 * pass-through: the same mtime must produce byte-identical events across two
 * processings of the same content (so a re-process after watcher-state loss
 * dedups portal-side), and the wall-clock fallback must be used when no mtime
 * is supplied.
 */

const CLINIC = "00000000-0000-0000-0000-000000000001";

/** Same encoding the watcher tests use. */
function gdt(lines: Array<[string, string]>): Buffer {
  let body = "";
  for (const [fk, value] of lines) {
    const payload = `${fk}${value}`;
    const total = 3 + payload.length + 2;
    body += `${String(total).padStart(3, "0")}${payload}\r\n`;
  }
  return Buffer.from(body, "latin1");
}

// A plain patient export (Satzart 6301) carries no business date, so its
// occurredAt falls back to the file mtime — the case the wiring exists for.
const PATIENT_LINES: Array<[string, string]> = [
  ["8000", "6301"],
  ["3000", "PAT-42"],
  ["3101", "Müller"],
  ["3102", "Maria"],
  ["3103", "15061980"],
  ["3110", "2"],
];

async function processGdtWithMtime(mtimeMs: number) {
  const parsed = await parseGdtFile(gdt(PATIENT_LINES));
  return gdtToCanonical(parsed, {
    clinicId: CLINIC,
    contentHash: parsed.contentHash,
    // exactly what watcher.ts computes from preStat.mtimeMs
    fileModifiedAtIso: new Date(mtimeMs).toISOString(),
  });
}

describe("watcher.ts mtime wiring (GDT)", () => {
  it("same content + same mtime processed twice yields identical events", async () => {
    const mtimeMs = 1_716_100_000_000; // fixed
    const first = await processGdtWithMtime(mtimeMs);
    const second = await processGdtWithMtime(mtimeMs);
    expect(first.length).toBe(1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // occurredAt is the mtime, not wall clock.
    expect(first[0].occurredAt).toBe(new Date(mtimeMs).toISOString());
  });

  it("a different mtime shifts occurredAt", async () => {
    const a = await processGdtWithMtime(1_716_100_000_000);
    const b = await processGdtWithMtime(1_716_200_000_000);
    expect(a[0].occurredAt).not.toBe(b[0].occurredAt);
  });
});

describe("csv-watcher.ts mtime wiring (CSV)", () => {
  // A patients full-sync row carries no business date, so occurredAt falls
  // back to fileModifiedAtIso.
  const mapping: CsvMapping = {
    stream: "patients",
    columns: {
      pvsPatientId: "Patient-Nr.",
      firstName: "Vorname",
      lastName: "Nachname",
    },
    dateFormat: "DD.MM.YYYY",
  };
  const row = { "Patient-Nr.": "PAT-1", Vorname: "Maria", Nachname: "Müller" };

  function mapWithMtime(mtimeMs: number | undefined) {
    return mapCsvRow({
      clinicId: CLINIC,
      fileHash: "hash-abc",
      rowIndex: 0,
      row,
      mapping,
      fileModifiedAtIso:
        mtimeMs === undefined ? undefined : new Date(mtimeMs).toISOString(),
    });
  }

  it("same row + same mtime yields identical events across two runs", () => {
    const mtimeMs = 1_716_100_000_000;
    const a = mapWithMtime(mtimeMs);
    const b = mapWithMtime(mtimeMs);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(a.events[0].occurredAt).toBe(new Date(mtimeMs).toISOString());
  });
});
