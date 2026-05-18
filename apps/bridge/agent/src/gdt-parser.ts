import iconv from "iconv-lite";

/**
 * GDT (Gerätedatenträger) field-record parser.
 *
 * GDT files are line-oriented; each line is:
 *
 *   LLLFFFCONTENT\r\n
 *
 * where:
 *   LLL  = 3-digit zero-padded length of the entire line (incl. LLL + FFF + CRLF)
 *   FFF  = 4-digit Feldkennung (field id; we treat it as 4 chars to be safe)
 *   CONTENT = ASCII (often ISO-8859-1) payload up to LLL minus 9
 *
 * GDT carries entire "Satzart" sets in sequence; the most relevant for us:
 *
 *   6301 — Patientendaten an PVS senden (PVS exports patient data)
 *   8316 — Behandlungsdaten (treatment record)
 *   6310 — Erfassung neue Patientendaten
 *   6200 — Beschwerden / Befunde
 *
 * We parse all field records into a flat array and let normalize.ts pick
 * the fields it needs for each canonical event.
 */

export interface GdtRecord {
  /** Field id, e.g. "8316" or "3101". */
  feldKennung: string;
  /** Payload, ISO-8859-1 decoded. */
  value: string;
}

export interface GdtParseResult {
  /** All records in source order. */
  records: GdtRecord[];
  /** Detected Satzart (e.g. "8000-6301"). */
  satzart?: string;
  /** Sha-256 of raw bytes — used as dedup key in pvsExternalEventId. */
  contentHash: string;
}

export async function parseGdtFile(bytes: Buffer): Promise<GdtParseResult> {
  // Auto-detect encoding: most German PVS emit ISO-8859-1, but some emit
  // UTF-8 nowadays. Heuristic: try ISO first, validate roundtrip on UTF-8
  // multibyte sequences if any appear.
  const decoded = decodeGdt(bytes);
  const records = parseLines(decoded);
  const satzart = findSatzart(records);
  const hash = await sha256(bytes);
  return { records, satzart, contentHash: hash };
}

function decodeGdt(bytes: Buffer): string {
  // Try ISO-8859-15 (covers ISO-8859-1 + €) first. If that produces
  // replacement characters where the byte sequence looks like UTF-8,
  // re-try UTF-8.
  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("�")) {
    // Check whether ISO would give the same result; if both are clean,
    // prefer UTF-8 (modern PVS).
    return utf8;
  }
  return iconv.decode(bytes, "ISO-8859-15");
}

function parseLines(decoded: string): GdtRecord[] {
  const lines = decoded.split(/\r?\n/);
  const records: GdtRecord[] = [];
  for (const line of lines) {
    if (line.length < 7) continue;
    // First 3 chars = length (sanity-check but tolerate violations).
    const fk = line.slice(3, 7);
    const value = line.slice(7).trim();
    if (!/^\d{4}$/.test(fk)) continue;
    records.push({ feldKennung: fk, value });
  }
  return records;
}

function findSatzart(records: GdtRecord[]): string | undefined {
  // Satzart is FK 8000.
  return records.find((r) => r.feldKennung === "8000")?.value;
}

async function sha256(bytes: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

/** Convenience helpers used by normalize.ts. */
export function pickFirst(records: GdtRecord[], fk: string): string | undefined {
  return records.find((r) => r.feldKennung === fk)?.value;
}

export function pickAll(records: GdtRecord[], fk: string): string[] {
  return records.filter((r) => r.feldKennung === fk).map((r) => r.value);
}
