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

/** One Satz: everything from an FK 8000 record up to (excluding) the next
 *  FK 8000. GDT files carry exactly one; BDT batch files carry many. */
export interface GdtSatz {
  /** Satzart, the value of the leading FK 8000 (e.g. "6301"). */
  satzart: string;
  /** All records of this Satz, including the 8000 itself. */
  records: GdtRecord[];
}

export type GdtEncoding = "utf8" | "iso-8859-15" | "cp1252";

export interface GdtParseResult {
  /** All records in source order (across all Sätze). */
  records: GdtRecord[];
  /** Satzart of the FIRST Satz (kept for logging + back-compat). */
  satzart?: string;
  /** Sätze segmented at FK 8000 boundaries. A plain GDT file yields one;
   *  a BDT batch export yields one per patient record. normalize.ts MUST
   *  translate per Satz: flattening a multi-Satz file merges every
   *  patient into one and sums all Honorar lines into a single invoice. */
  saetze: GdtSatz[];
  /** Sha-256 of raw bytes — used as dedup key in pvsExternalEventId. */
  contentHash: string;
  /** Encoding chosen by the probe; exposed for tests + ops visibility. */
  encoding: GdtEncoding;
  /**
   * L6: count of lines whose 3-digit LLL length prefix claimed MORE bytes than
   * the line actually holds (LLL > actual bytes + CR LF). That is the signature
   * of a torn / truncated line: the exporter wrote the length header for a value
   * it never finished writing. Such lines are dropped rather than emitted with a
   * silently truncated value; this counter lets parseGdtFile + the watcher warn
   * loudly so a systematic truncation defect is visible instead of hidden.
   */
  suspectLineCount: number;
}

/**
 * Thrown when a file looks like a torn write (still being written when we
 * read it). GDT/BDT mandates a CR LF terminator after EVERY line including
 * the last, so a missing final terminator means the exporter had not
 * finished writing. The watcher treats this as "not yet processable": it
 * logs, does NOT enqueue, and does NOT advance the mtime cursor, so the
 * completed file is re-processed on the next change event or restart.
 * Parsing a torn file instead would poison the outbox: the truncated
 * parse wins the per-event-id dedup and the corrected re-parse is
 * silently discarded (reliability review C1).
 */
export class TornGdtFileError extends Error {
  constructor(detail: string) {
    super(`GDT file appears incompletely written (torn write): ${detail}`);
    this.name = "TornGdtFileError";
  }
}

export async function parseGdtFile(bytes: Buffer): Promise<GdtParseResult> {
  const { text, encoding } = decodeBytesBestEffort(bytes);
  if (text.length > 0 && !/\r?\n$/.test(text)) {
    throw new TornGdtFileError(
      "file does not end with a line terminator (CR LF is mandatory after every GDT line, including the last)"
    );
  }
  const { records, suspectLineCount } = parseLines(text, encoding);
  const saetze = segmentSaetze(records);
  const satzart = saetze[0]?.satzart;
  const hash = await sha256(bytes);
  console.debug(
    `[gdt-parser] decoded as ${encoding} (sha256=${hash.slice(0, 12)}, saetze=${saetze.length})`
  );
  if (suspectLineCount > 0) {
    // L6: surface, do not swallow. These lines claimed a longer length than
    // present (probable truncation) and their values were dropped.
    console.warn(
      `[gdt-parser] ${suspectLineCount} line(s) claim a longer LLL length than present (probable truncation); their values were dropped (sha256=${hash.slice(0, 12)})`
    );
  }
  return { records, satzart, saetze, contentHash: hash, encoding, suspectLineCount };
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

/**
 * Decode a byte buffer under all three plausible German-PVS encodings and
 * pick the best-scoring result. Exported so the CSV parser reuses the exact
 * same 3-candidate scoring probe (M-P1) instead of the old utf8-or-fallback
 * decode that silently accepted double-encoded UTF-8 and had no CP1252
 * candidate at all. See scoreDecoded for the scoring rule.
 */
export function decodeBytesBestEffort(bytes: Buffer): {
  text: string;
  encoding: GdtEncoding;
} {
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

function parseLines(
  decoded: string,
  encoding: GdtEncoding
): { records: GdtRecord[]; suspectLineCount: number } {
  const lines = decoded.split(/\r?\n/);
  const records: GdtRecord[] = [];
  let suspectLineCount = 0;
  for (const line of lines) {
    if (line.length < 7) continue;
    // L6: validate the 3-digit LLL length prefix against the actual line bytes.
    // GDT's LLL is the byte length of the WHOLE line INCLUDING its CR LF, so a
    // conformant line has byteLen(line, encoding) + 2 === LLL. We only reject a
    // line when it claims MORE bytes than exist (LLL > byteLen + 2): that is the
    // torn / truncated case where a length header was written for a value the
    // exporter never finished. Lines that are longer than claimed, or exporters
    // that count LLL WITHOUT the terminator, still satisfy byteLen + 2 >= LLL
    // and are left alone, so this does not false-positive on those conventions.
    const lll = line.slice(0, 3);
    if (/^\d{3}$/.test(lll)) {
      const claimed = Number(lll);
      const actualWithCrlf = byteLen(line, encoding) + 2;
      if (claimed > actualWithCrlf) {
        // Truncated line: drop it rather than push a silently truncated value.
        suspectLineCount++;
        continue;
      }
    }
    // First 3 chars = length (sanity-check but tolerate violations).
    const fk = line.slice(3, 7);
    const value = line.slice(7).trim();
    if (!/^\d{4}$/.test(fk)) continue;
    records.push({ feldKennung: fk, value });
  }
  return { records, suspectLineCount };
}

/**
 * Byte length of a decoded line in its SOURCE encoding, so the LLL check
 * (which counts bytes) stays correct for multi-byte UTF-8 content as well as
 * the single-byte 8-bit codecs.
 */
function byteLen(s: string, encoding: GdtEncoding): number {
  return encoding === "utf8"
    ? Buffer.byteLength(s, "utf8")
    : iconv.encode(s, encoding).length;
}

/**
 * Segment a flat record list into Sätze at FK 8000 boundaries (C2). BDT is
 * by definition a multi-record batch format: one file can carry hundreds of
 * patients, each introduced by its own FK 8000. Records BEFORE the first
 * 8000 belong to no Satz (structural preamble in non-conformant exports)
 * and are dropped from segmentation; they remain visible in `records`.
 */
function segmentSaetze(records: GdtRecord[]): GdtSatz[] {
  const saetze: GdtSatz[] = [];
  let current: GdtSatz | null = null;
  for (const r of records) {
    if (r.feldKennung === "8000") {
      current = { satzart: r.value, records: [r] };
      saetze.push(current);
      continue;
    }
    if (current) current.records.push(r);
  }
  return saetze;
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
