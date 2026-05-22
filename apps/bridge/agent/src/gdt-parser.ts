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

export type GdtEncoding = "utf8" | "iso-8859-15" | "cp1252";

export interface GdtParseResult {
  /** All records in source order. */
  records: GdtRecord[];
  /** Detected Satzart (e.g. "8000-6301"). */
  satzart?: string;
  /** Sha-256 of raw bytes — used as dedup key in pvsExternalEventId. */
  contentHash: string;
  /** Encoding chosen by the probe; exposed for tests + ops visibility. */
  encoding: GdtEncoding;
}

export async function parseGdtFile(bytes: Buffer): Promise<GdtParseResult> {
  const { text, encoding } = decodeGdt(bytes);
  const records = parseLines(text);
  const satzart = findSatzart(records);
  const hash = await sha256(bytes);
  console.debug(
    `[gdt-parser] decoded as ${encoding} (sha256=${hash.slice(0, 12)})`
  );
  return { records, satzart, contentHash: hash, encoding };
}

const DIACRITICS = new Set(["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü", "€"]);
const MOJIBAKE_MARKERS = new Set(["}", "{", "|", "~"]);
const REPLACEMENT_CHAR = "�";

function isAsciiLetter(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiConsonant(ch: string): boolean {
  return isAsciiLetter(ch) && !"aeiouAEIOU".includes(ch);
}

function scoreDecoded(text: string): number {
  // +1 per plausible German diacritic; -3 per U+FFFD; -1 per 7-bit-DIN-66003
  // mojibake marker ({ | } ~) that sits between two ASCII consonants — the
  // shape of "M}ller" / "Stra~e" when a file is actually DIN 66003 but
  // read as ASCII/UTF-8/CP1252.
  let score = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DIACRITICS.has(ch)) {
      score += 1;
      continue;
    }
    if (ch === REPLACEMENT_CHAR) {
      score -= 3;
      continue;
    }
    if (
      MOJIBAKE_MARKERS.has(ch) &&
      i > 0 &&
      i < text.length - 1 &&
      isAsciiConsonant(text[i - 1]) &&
      isAsciiConsonant(text[i + 1])
    ) {
      score -= 1;
    }
  }
  return score;
}

function decodeGdt(bytes: Buffer): { text: string; encoding: GdtEncoding } {
  // Decode the bytes under all three plausible 8-bit candidates and pick
  // the one that produces the most plausibly-German output. The legacy
  // approach (utf8 first, fall back to ISO-8859-15 only on U+FFFD) silently
  // corrupted CP1252 files whose bytes happened to be valid UTF-8 — the
  // common "Jürgen Müller" failure mode where 0xFC ("ü") gets replaced by
  // U+FFFD without anyone noticing. Probing all three and scoring the
  // result catches CP1252 vs ISO-8859-15 mismatches around €/¤ as well.
  //
  // Tie-break: utf8 > iso-8859-15 > cp1252 (array order; JS sort is stable
  // since ES2019, which Node 20 honours).
  const candidates: Array<{ encoding: GdtEncoding; text: string }> = [
    { encoding: "utf8", text: bytes.toString("utf8") },
    { encoding: "iso-8859-15", text: iconv.decode(bytes, "ISO-8859-15") },
    { encoding: "cp1252", text: iconv.decode(bytes, "CP1252") },
  ];
  const scored = candidates.map((c) => ({ ...c, score: scoreDecoded(c.text) }));
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  return { text: winner.text, encoding: winner.encoding };
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
