import iconv from "iconv-lite";
import { createHash } from "node:crypto";
import { decodeBytesBestEffort } from "./gdt-parser.js";

/**
 * Minimal CSV parser for Honorar / Abrechnungs exports from German PVS.
 *
 * Rationale for the in-house parser (vs. csv-parse): the agent binary is
 * `pkg`-bundled and ships to Praxis machines; every added dependency
 * inflates the .exe and increases the chance of native-module
 * incompatibility between Windows 10/11 + macOS Intel/ARM. This parser
 * covers RFC 4180 plus the German-PVS quirks (semicolon delimiter, comma
 * decimals, optional BOM, ISO-8859-15 encoding).
 *
 * What it handles:
 *   - delimiter auto-detect (semicolon > tab > comma)
 *   - quoted fields with embedded delimiters / quotes ("a""b")
 *   - multi-line quoted fields (RFC 4180): a field opened with `"` continues
 *     across newlines until its closing quote, so a Bemerkung cell containing
 *     a newline stays ONE row instead of shifting every following column (H9)
 *   - UTF-8 BOM strip (byte-level, so a Latin-1 body under a UTF-8 BOM does
 *     not leave a mojibake prefix on the first header)
 *   - UTF-16LE / UTF-16BE BOM detection (Excel "Unicode Text" export)
 *   - CRLF and LF line endings
 *   - ISO-8859-15 fallback when UTF-8 decode produces replacement chars
 */

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: ";" | "," | "\t";
  contentHash: string;
  /**
   * Torn-write guard (reliability review C1 + H9). True when the last logical
   * row was DROPPED because either (a) the file did not end with a line
   * terminator, or (b) the file ended in the middle of an OPEN quoted field
   * (an unbalanced quote). In both cases the tail is a half-written / damaged
   * row that would otherwise parse with wrong columns or a wrong amount.
   * Because the outbox dedups by event id, that wrong row would win
   * permanently and the corrected re-parse would be discarded. Callers must
   * log this loudly and must NOT advance the watcher cursor past the file.
   */
  droppedSuspectLastRow: boolean;
  /**
   * M-P3: count of DATA rows whose cell count did not match the header count
   * (ragged rows). Extra cells are dropped, missing cells become empty strings
   * as before; this counter lets the watcher log a rate-limited warning so a
   * systematic column-shift defect is visible instead of silently tolerated.
   */
  raggedRowCount: number;
  /**
   * M-P3: header names that appear more than once. A duplicate header collides
   * in the per-row record (last column wins), which silently swaps meaning for
   * ambiguous columns (two "Betrag" columns → netto/brutto swap). The watcher
   * fails the file loudly when a duplicate is a column the mapper would map,
   * and warns for harmless unmapped duplicates.
   */
  duplicateHeaders: string[];
  /**
   * M-P9: true when parsing stopped early because the row cap was reached (a
   * further data row existed beyond the cap). The row objects are built DURING
   * parsing, so the cap must stop allocation here rather than after the fact.
   * The watcher skips a cap-exceeded file loudly.
   */
  rowCapExceeded: boolean;
}

/**
 * Thrown by parseCsv when the raw byte length exceeds the configured cap
 * (M-P9). The multi-candidate scored decode runs the whole buffer through
 * three decoders, so the size must be gated BEFORE decoding, not after the
 * row objects are already allocated. The watcher's pre-read stat check is the
 * first line of defence; this is the in-parser backstop.
 */
export class CsvFileTooLargeError extends Error {
  constructor(actualBytes: number, maxBytes: number) {
    super(
      `CSV file too large: ${actualBytes} bytes exceeds cap of ${maxBytes} bytes`
    );
    this.name = "CsvFileTooLargeError";
  }
}

export interface ParseCsvOptions {
  /** M-P9: hard cap on rows built. Parsing stops early once reached. */
  maxRows?: number;
  /** M-P9: hard cap on raw byte length, checked before the scored decode. */
  maxBytes?: number;
}

export function parseCsv(
  bytes: Buffer,
  opts: ParseCsvOptions = {}
): CsvParseResult {
  // M-P9 part 2: gate the byte length BEFORE the multi-candidate decode, which
  // would otherwise run the full buffer through three decoders.
  if (opts.maxBytes !== undefined && bytes.length > opts.maxBytes) {
    throw new CsvFileTooLargeError(bytes.length, opts.maxBytes);
  }
  const contentHash = sha256(bytes);
  const text = decodeCsv(bytes).replace(/^﻿/, "");
  // H9: split into LOGICAL rows honoring quote state, so a newline inside a
  // quoted cell does not end the row. Also reports whether the file ended
  // cleanly on a row terminator and whether it ended mid-open-quote.
  const { rows: logicalRows, endsWithNewline, unterminatedQuote } =
    splitLogicalRows(text);
  // Empty / zero-byte file: no logical rows at all. This branch is NOT dead:
  // it guards the header access below (detectDelimiter(logicalRows[0]) would
  // throw on an empty array). It returns headers:[] so the watcher can treat
  // "zero-byte file" the same as "produced zero events" (see csv-watcher.ts,
  // L4/L5: warn once, then advance the cursor so it does not re-warn forever).
  if (logicalRows.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter: ";",
      contentHash,
      droppedSuspectLastRow: false,
      raggedRowCount: 0,
      duplicateHeaders: [],
      rowCapExceeded: false,
    };
  }
  // C1 + H9: no final line terminator, OR a file ending mid-open-quote, means
  // the last logical row may be a torn write. Drop it (data rows only; a
  // header-only file has nothing to poison) and flag the drop so the watcher
  // refuses to advance its cursor. An unbalanced trailing quote is always
  // suspect even if its (partial) tail is non-blank; a merely newline-less
  // tail is only suspect when it carries content.
  let droppedSuspectLastRow = false;
  let lastDataRow = logicalRows.length;
  if ((!endsWithNewline || unterminatedQuote) && logicalRows.length > 1) {
    lastDataRow = logicalRows.length - 1;
    if (unterminatedQuote || logicalRows[logicalRows.length - 1].trim()) {
      droppedSuspectLastRow = true;
    }
  }
  const delimiter = detectDelimiter(logicalRows[0]);
  const headers = splitRow(logicalRows[0], delimiter);
  const duplicateHeaders = findDuplicateHeaders(headers);
  const rows: Record<string, string>[] = [];
  let raggedRowCount = 0;
  let rowCapExceeded = false;
  for (let i = 1; i < lastDataRow; i++) {
    const line = logicalRows[i];
    if (!line.trim()) continue;
    // M-P9 part 1: enforce the row cap DURING parsing. Reaching the cap with a
    // further non-blank data line still pending means the file exceeds it, so
    // flag and stop before allocating another row object.
    if (opts.maxRows !== undefined && rows.length >= opts.maxRows) {
      rowCapExceeded = true;
      break;
    }
    const cells = splitRow(line, delimiter);
    // M-P3: a cell count other than the header count is a ragged row. Keep the
    // historical tolerant behaviour (drop extras, pad missing with "") but
    // count it so the watcher can surface a systematic column shift.
    if (cells.length !== headers.length) raggedRowCount++;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return {
    headers,
    rows,
    delimiter,
    contentHash,
    droppedSuspectLastRow,
    raggedRowCount,
    duplicateHeaders,
    rowCapExceeded,
  };
}

/** M-P3: header names that appear more than once, each reported once. */
function findDuplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) dupes.add(h);
    else seen.add(h);
  }
  return [...dupes];
}

function decodeCsv(bytes: Buffer): string {
  // L3: BOM-aware decode. Order matters: check the multi-byte UTF-16 BOMs
  // BEFORE anything else, because Excel's "Unicode Text (*.txt)" export is
  // UTF-16LE with a BOM and, decoded as UTF-8, turns into NUL-laced garbage
  // that carries no U+FFFD (so the ISO-8859-15 fallback below never fires) and
  // silently breaks header matching ("no usable mapping").
  if (bytes.length >= 2) {
    // UTF-16LE BOM (FF FE): most common Excel Unicode export.
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return iconv.decode(bytes.subarray(2), "utf16-le");
    }
    // UTF-16BE BOM (FE FF).
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return iconv.decode(bytes.subarray(2), "utf16-be");
    }
  }
  // L3: strip a UTF-8 BOM (EF BB BF) at the BYTE level before decoding. A file
  // written with a UTF-8 BOM but a Latin-1 body (a real medatixx quirk) decodes
  // to U+FFFD, falls through to the ISO-8859-15 branch, and there the BOM bytes
  // would otherwise re-surface as the mojibake prefix "ï»¿" glued onto the first
  // header cell. Removing the BOM bytes up front keeps the first header clean in
  // both the UTF-8 and the Latin-1-body case.
  const body =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  // M-P1: reuse the GDT parser's 3-candidate scored decode (UTF-8 /
  // ISO-8859-15 / CP1252) instead of the old utf8-or-ISO fallback. The old
  // path had no CP1252 candidate and accepted double-encoded UTF-8 verbatim,
  // ingesting mojibake names silently ("Jürgen Müller" where 0xFC never
  // triggered U+FFFD). scoreDecoded picks the most plausibly-German result.
  return decodeBytesBestEffort(body).text;
}

/**
 * Split text into LOGICAL CSV rows (RFC 4180). A field opened with `"`
 * continues across newlines until its closing `"`; `""` inside a quoted field
 * is a literal quote and does NOT toggle quote state. Newlines OUTSIDE quotes
 * (LF or CRLF) terminate a row.
 *
 * Returns:
 *   - rows: the logical row strings, each still containing its raw quotes and
 *     any embedded newlines (splitRow later turns them into cells).
 *   - endsWithNewline: the text ended on an unquoted row terminator (nothing
 *     trailing after it). Used by the torn-write guard.
 *   - unterminatedQuote: the text ended while still inside an open quoted
 *     field (an unbalanced quote), which the caller treats as a torn write
 *     for the affected trailing row.
 */
function splitLogicalRows(text: string): {
  rows: string[];
  endsWithNewline: boolean;
  unterminatedQuote: boolean;
} {
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        // Escaped quote: keep both chars verbatim, stay in-quotes.
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += c;
      }
      continue;
    }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++; // consume CRLF as one break
      rows.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  const unterminatedQuote = inQuotes;
  // `cur` holds the segment after the last unquoted row terminator. Non-empty
  // (a newline-less final line) or an open quote means there is a trailing
  // logical row; push it. Empty + closed means the file ended cleanly.
  if (cur !== "" || unterminatedQuote) rows.push(cur);
  const endsWithNewline = cur === "" && !unterminatedQuote;
  return { rows, endsWithNewline, unterminatedQuote };
}

function detectDelimiter(headerLine: string): ";" | "," | "\t" {
  // M-P2: genuinely count-based. The delimiter that occurs MOST OFTEN in the
  // header (outside quoted ranges) wins; ties break in the order ; > tab > ,
  // (German-PVS default first). The old code was presence-based, not
  // count-based despite the comment: a single stray semicolon in a
  // tab-separated header beat five tabs. If no candidate occurs, default to
  // comma (a single-column file has no delimiter to detect).
  const counts: Record<";" | "\t" | ",", number> = {
    ";": countOutsideQuotes(headerLine, ";"),
    "\t": countOutsideQuotes(headerLine, "\t"),
    ",": countOutsideQuotes(headerLine, ","),
  };
  const tiebreakOrder: Array<";" | "\t" | ","> = [";", "\t", ","];
  let best: ";" | "\t" | "," = ",";
  let bestCount = 0;
  for (const candidate of tiebreakOrder) {
    // Strict `>` keeps the earlier (higher-priority) candidate on a tie.
    if (counts[candidate] > bestCount) {
      bestCount = counts[candidate];
      best = candidate;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, ch: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++; // escaped quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && c === ch) count++;
  }
  return count;
}

function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && c === delimiter) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur);
  return cells.map((v) => v.trim());
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
