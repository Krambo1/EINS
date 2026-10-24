import { createHash } from "node:crypto";
import iconv from "iconv-lite";

/**
 * GDT / BDT (xDT family) field-record parser.
 *
 * Ground truth: "GDT V 2.1 (5/01)" by the Qualitätsring Medizinische Software
 * (QMS), plus vendor docs (CGM Turbomed GDT-Anbindung, PADSY GDT FAQ).
 *
 * Line format (spec 2.6.1): `LLLFFFFcontent<CR><LF>`
 *   LLL  = 3-digit length of the WHOLE line in bytes, INCLUDING CR LF
 *   FFFF = 4-digit Feldkennung (field id)
 *   content = field value in the declared character set
 *
 * A Satz starts with FK 8000 (Satzart) followed by FK 8100 (Satzlänge = the
 * byte length of the entire Satz incl. every CR LF). The spec explicitly
 * allows several Sätze, of different Satzarten and patients, in one file.
 *
 * Satzarten (spec 3):
 *   6300 Stammdaten anfordern            device → PVS
 *   6301 Stammdaten übermitteln          PVS → device
 *   6302 Neue Untersuchung anfordern     PVS → device
 *   6310 Daten einer Untersuchung übermitteln  device → PVS
 *   6311 Daten einer Untersuchung zeigen PVS → device
 * BDT (Behandlungsdatenträger, full PVS export) uses the same line format;
 * its patient master record is Satzart 6100.
 *
 * Character set (spec 2.2 + FK 9206): the STANDARD is IBM CP437. FK 9206
 * declares 1 = 7-bit (DIN 66003, German umlauts on [ \ ] { | } ~),
 * 2 = CP437, 3 = ISO-8859-1 / CP1252 (ANSI). Several PVS also write UTF-8.
 * Real exporters do not always declare 9206 correctly, so the declaration
 * is a strong prior, not the final word: we decode under every candidate and
 * pick the most plausible German text, with a bonus for the declared one.
 */

export interface GdtRecord {
  /** Field id, e.g. "3101". */
  feldKennung: string;
  /** Decoded payload, surrounding whitespace trimmed. */
  value: string;
}

/** One Satz: everything from an FK 8000 record up to the next FK 8000. */
export interface GdtSatz {
  /** Satzart, the value of the leading FK 8000 (e.g. "6301"). */
  satzart: string;
  /** All records of this Satz, including the 8000 itself. */
  records: GdtRecord[];
  /** FK 8100 Satzlänge as declared (bytes), if present and numeric. */
  declaredLength?: number;
  /** Actual byte length of this Satz in the file, terminators included. */
  actualLength: number;
  /** True when FK 8100 is present and matches the actual byte length.
   *  A matching 8100 proves the Satz was written completely. Many PVS write
   *  a wrong or zero 8100, so a mismatch is NOT treated as corruption. */
  lengthVerified: boolean;
}

export type GdtEncoding =
  | "utf8"
  | "iso-8859-15"
  | "cp1252"
  | "cp437"
  | "din66003";

export interface GdtParseResult {
  /** All records in source order (across all Sätze). */
  records: GdtRecord[];
  /** Satzart of the FIRST Satz (logging + back-compat). */
  satzart?: string;
  /** Sätze segmented at FK 8000 boundaries. */
  saetze: GdtSatz[];
  /** sha-256 of the raw bytes; used in event ids. */
  contentHash: string;
  /** Encoding chosen by the probe. */
  encoding: GdtEncoding;
  /** Encoding declared by FK 9206 (first Satz), if any. */
  declaredEncoding?: GdtEncoding;
  /** True when the last line ends with a line terminator (CR LF mandatory
   *  per spec). False is the signature of a file still being written OR of
   *  an exporter that omits the final CR LF; the watcher decides which by
   *  waiting for the file to be stable. */
  endsWithTerminator: boolean;
  /** Lines whose LLL claims MORE bytes than present (probable truncation).
   *  Such lines are dropped instead of emitting a silently cut value. */
  suspectLineCount: number;
}

/** Kept for API compatibility. parseGdtFile no longer throws it: a missing
 *  final CR LF is reported via `endsWithTerminator` and resolved by the
 *  watcher (stable file = complete file), because a PVS that omits the final
 *  terminator would otherwise block its GDT channel forever. */
export class TornGdtFileError extends Error {
  constructor(detail: string) {
    super(`GDT file appears incompletely written (torn write): ${detail}`);
    this.name = "TornGdtFileError";
  }
}

export async function parseGdtFile(bytes: Buffer): Promise<GdtParseResult> {
  const declaredEncoding = sniffDeclaredEncoding(bytes);
  const { text, encoding } = decodeBytesBestEffort(bytes, {
    declared: declaredEncoding,
    allowDin66003: true,
  });
  const endsWithTerminator = text.length === 0 || /[\r\n]$/.test(text);
  const { records, lineLengths, suspectLineCount } = parseLines(text, encoding);
  const saetze = segmentSaetze(records, lineLengths);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  if (suspectLineCount > 0) {
    console.warn(
      `[gdt-parser] ${suspectLineCount} line(s) claim a longer LLL length than present (probable truncation); their values were dropped (sha256=${contentHash.slice(0, 12)})`
    );
  }
  if (declaredEncoding && declaredEncoding !== encoding) {
    console.warn(
      `[gdt-parser] FK 9206 declares ${declaredEncoding} but the content decodes as ${encoding}; using ${encoding} (sha256=${contentHash.slice(0, 12)})`
    );
  }
  return {
    records,
    satzart: saetze[0]?.satzart,
    saetze,
    contentHash,
    encoding,
    declaredEncoding,
    endsWithTerminator,
    suspectLineCount,
  };
}

/**
 * Read FK 9206 straight from the bytes. LLL, FK and the digit are ASCII in
 * every candidate encoding, so a latin1 view is safe for this probe.
 */
function sniffDeclaredEncoding(bytes: Buffer): GdtEncoding | undefined {
  const head = bytes.subarray(0, 4096).toString("latin1");
  const m = head.match(/(?:^|[\r\n])\d{3}9206\s*(\d)/);
  if (!m) return undefined;
  switch (m[1]) {
    case "1":
      return "din66003";
    case "2":
      return "cp437";
    case "3":
      return "cp1252";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** DIN 66003 (German 7-bit ISO 646): these ASCII positions carry umlauts. */
const DIN66003_MAP: Record<string, string> = {
  "@": "§",
  "[": "Ä",
  "\\": "Ö",
  "]": "Ü",
  "{": "ä",
  "|": "ö",
  "}": "ü",
  "~": "ß",
};

function decodeDin66003(bytes: Buffer): string {
  let out = "";
  const ascii = bytes.toString("latin1");
  for (const ch of ascii) out += DIN66003_MAP[ch] ?? ch;
  return out;
}

const GERMAN_LETTERS = new Set(["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"]);
const DIN_MARKERS = new Set(["[", "\\", "]", "{", "|", "}", "~"]);

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

/** Non-ASCII characters that are plausible inside German/Western names and
 *  addresses: Latin-1 letters, €, °, §, µ, typographic quotes/dashes. */
function isPlausibleNonAscii(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0xc0 && c <= 0xff && c !== 0xd7 && c !== 0xf7) return true; // À..ÿ minus × ÷
  return "€°§µ„“”‚‘’–·".includes(ch) || c === 0xa0;
}

/**
 * Plausibility score of decoded text as German PVS content.
 *   +2  per German letter (äöüßÄÖÜ)
 *   -4  per U+FFFD or C0/C1 control character (except CR, LF, TAB)
 *   -2  per non-ASCII character that is implausible in names/addresses
 *       (box drawing, Greek, math symbols: the shape of CP1252 bytes read as
 *       CP437 and vice versa)
 *   -1  per DIN 66003 marker character sitting between two letters
 *       ("M}ller"): the shape of a 7-bit file read as ASCII
 *   -2  per typographic punctuation char sitting between two letters
 *       ("J„ger" = CP437 'ä' read as CP1252)
 */
function scoreDecoded(text: string): number {
  let score = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Fast path: plain printable ASCII that is not a DIN 66003 marker.
    if (c >= 0x20 && c < 0x7f && !DIN_MARKERS.has(text[i])) continue;
    const ch = text[i];
    if (GERMAN_LETTERS.has(ch)) {
      score += 2;
      continue;
    }
    if (ch === "�") {
      score -= 4;
      continue;
    }
    if (c < 0x20 && ch !== "\r" && ch !== "\n" && ch !== "\t") {
      score -= 4;
      continue;
    }
    if (c >= 0x7f && c <= 0x9f) {
      score -= 4;
      continue;
    }
    const between = isLetter(text[i - 1]) && isLetter(text[i + 1]);
    if (c < 0x80) {
      if (between && DIN_MARKERS.has(ch)) score -= 1;
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) continue; // UTF-16 surrogate half (emoji etc.)
    if (!isPlausibleNonAscii(ch)) {
      score -= 2;
      continue;
    }
    if (between && "„“”‚‘’–·".includes(ch)) score -= 2;
  }
  return score;
}

const DECLARED_BONUS = 3;

/**
 * Decode bytes under every plausible German-PVS encoding and keep the most
 * plausible text. Exported for the Honorar-CSV parser (which does not allow
 * the 7-bit DIN variant: CSV exports are never 7-bit).
 *
 * Order = tie-break preference: utf8, iso-8859-15, cp1252, cp437, din66003.
 * A UTF-8 BOM forces utf8.
 */
export function decodeBytesBestEffort(
  bytes: Buffer,
  opts: { declared?: GdtEncoding; allowDin66003?: boolean } = {}
): { text: string; encoding: GdtEncoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.subarray(3).toString("utf8"), encoding: "utf8" };
  }
  const sevenBit = !bytes.some((b) => b > 0x7f);
  const encodings: GdtEncoding[] = ["utf8", "iso-8859-15", "cp1252", "cp437"];
  if (opts.allowDin66003 && sevenBit) encodings.push("din66003");
  // Score on a sample: for big files (BDT exports can be tens of MB) only the
  // lines carrying non-ASCII bytes or DIN markers can tell encodings apart,
  // and decoding + scoring the whole file five times would be wasteful.
  const sample = scoringSample(bytes);
  let best: { encoding: GdtEncoding; score: number } | null = null;
  for (const enc of encodings) {
    let score = scoreDecoded(decodeAs(sample, enc));
    if (opts.declared === enc) score += DECLARED_BONUS;
    // A 9206=3 declaration ("ISO8859-1 (ANSI) CP 1252") also vouches for the
    // ISO-8859-15 reading; they only differ in a handful of code points.
    if (opts.declared === "cp1252" && enc === "iso-8859-15") {
      score += DECLARED_BONUS - 1;
    }
    if (!best || score > best.score) best = { encoding: enc, score };
  }
  return { text: decodeAs(bytes, best!.encoding), encoding: best!.encoding };
}

function decodeAs(bytes: Buffer, enc: GdtEncoding): string {
  switch (enc) {
    case "utf8":
      return bytes.toString("utf8");
    case "din66003":
      return decodeDin66003(bytes);
    case "iso-8859-15":
      return iconv.decode(bytes, "ISO-8859-15");
    case "cp1252":
      return iconv.decode(bytes, "CP1252");
    case "cp437":
      return iconv.decode(bytes, "CP437");
  }
}

const SAMPLE_LIMIT = 1024 * 1024;
const DIN_MARKER_BYTES = new Set([0x5b, 0x5c, 0x5d, 0x7b, 0x7c, 0x7d, 0x7e]);

function scoringSample(bytes: Buffer): Buffer {
  if (bytes.length <= SAMPLE_LIMIT) return bytes;
  const parts: Buffer[] = [];
  let total = 0;
  let start = 0;
  while (start < bytes.length && total < SAMPLE_LIMIT) {
    let end = bytes.indexOf(0x0a, start);
    if (end === -1) end = bytes.length - 1;
    const line = bytes.subarray(start, end + 1);
    if (line.some((b) => b > 0x7f || DIN_MARKER_BYTES.has(b))) {
      parts.push(line);
      total += line.length;
    }
    start = end + 1;
  }
  return parts.length > 0 ? Buffer.concat(parts) : bytes.subarray(0, SAMPLE_LIMIT);
}

// ---------------------------------------------------------------------------
// Lines and Sätze
// ---------------------------------------------------------------------------

function parseLines(
  decoded: string,
  encoding: GdtEncoding
): { records: GdtRecord[]; lineLengths: number[]; suspectLineCount: number } {
  const records: GdtRecord[] = [];
  const lineLengths: number[] = [];
  let suspectLineCount = 0;
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    const line = m[1];
    const term = m[2];
    if (line === "" && term === "") break; // end of input
    const lineBytes = byteLen(line, encoding) + term.length;
    if (line.length < 7) continue;
    const lll = line.slice(0, 3);
    if (/^\d{3}$/.test(lll)) {
      // LLL counts the whole line INCLUDING CR LF. Reject only lines that
      // claim MORE bytes than exist (torn/truncated). Lines longer than
      // claimed, or exporters that count without the terminator, pass.
      const claimed = Number(lll);
      if (claimed > byteLen(line, encoding) + 2) {
        suspectLineCount++;
        continue;
      }
    }
    const fk = line.slice(3, 7);
    if (!/^\d{4}$/.test(fk)) continue;
    records.push({ feldKennung: fk, value: line.slice(7).trim() });
    lineLengths.push(lineBytes);
  }
  return { records, lineLengths, suspectLineCount };
}

/** Byte length in the SOURCE encoding (all non-UTF-8 candidates are
 *  single-byte code pages, so one char = one byte). */
function byteLen(s: string, encoding: GdtEncoding): number {
  return encoding === "utf8" ? Buffer.byteLength(s, "utf8") : s.length;
}

function segmentSaetze(records: GdtRecord[], lineLengths: number[]): GdtSatz[] {
  const saetze: GdtSatz[] = [];
  let current: GdtSatz | null = null;
  records.forEach((r, i) => {
    if (r.feldKennung === "8000") {
      current = {
        satzart: r.value,
        records: [r],
        actualLength: lineLengths[i],
        lengthVerified: false,
      };
      saetze.push(current);
      return;
    }
    if (!current) return; // preamble before the first 8000: no Satz
    current.records.push(r);
    current.actualLength += lineLengths[i];
  });
  for (const s of saetze) {
    const raw = pickFirst(s.records, "8100");
    if (raw && /^\d+$/.test(raw)) {
      s.declaredLength = Number(raw);
      s.lengthVerified = s.declaredLength === s.actualLength;
    }
  }
  return saetze;
}

/** Convenience helpers used by normalize.ts. */
export function pickFirst(records: GdtRecord[], fk: string): string | undefined {
  const v = records.find((r) => r.feldKennung === fk)?.value;
  return v === undefined || v === "" ? undefined : v;
}

export function pickAll(records: GdtRecord[], fk: string): string[] {
  return records
    .filter((r) => r.feldKennung === fk && r.value !== "")
    .map((r) => r.value);
}
