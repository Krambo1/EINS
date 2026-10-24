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
   * True when the last non-blank DATA line of the file has no line terminator,
   * independent of tornWriteGuard. With tornWriteGuard:false that row is still
   * returned; callers (the watcher) can use this flag to wait for a fresh,
   * fully written file before trusting it.
   */
  lastLineUnterminated: boolean;
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
  /**
   * False when an `isHeader` predicate was given and none of the first
   * HEADER_SCAN_LINES non-empty lines satisfied it. `headers` then holds a
   * best-guess line for diagnostics only and `rows` is empty.
   */
  headerFound: boolean;
  /** Index of the header among the logical rows (-1 for an empty file). */
  headerLineIndex: number;
  /** Logical lines (incl. blank, sep=) skipped above the header. */
  preambleLines: number;
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
  /**
   * Header-row locator. When given, the first HEADER_SCAN_LINES non-empty
   * lines (after an optional `sep=X` line) are tried in order and the first
   * one for which the predicate returns true is the header; everything above
   * it (title line, `;;;` line, report banner) is skipped. Without it the
   * first non-empty line is the header.
   */
  isHeader?: (headers: string[]) => boolean;
  /**
   * Torn-write guard for a final line without a terminator (default true,
   * the historical behaviour). The Honorar watcher passes false: it already
   * waits for write-stability (awaitWriteFinish + pre/post stat), so an
   * unterminated last line of a stable file is a real row, and many PVS
   * exports legitimately omit the final newline. An UNBALANCED trailing quote
   * is still dropped and flagged in both modes.
   */
  tornWriteGuard?: boolean;
}

/** How many non-empty leading lines are tried as the header row. */
export const HEADER_SCAN_LINES = 15;

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
  // Phase A: locate the header on PHYSICAL lines. The delimiter has to be
  // known before rows can be split into logical rows (a quote only opens a
  // quoted field at field start, i.e. after a delimiter), so it is detected
  // from the header candidate line first.
  const lines = physicalLines(text);
  const emptyResult = (): CsvParseResult => ({
    headers: [],
    rows: [],
    delimiter: ";",
    contentHash,
    droppedSuspectLastRow: false,
    lastLineUnterminated: false,
    raggedRowCount: 0,
    duplicateHeaders: [],
    rowCapExceeded: false,
    headerFound: false,
    headerLineIndex: -1,
    preambleLines: 0,
  });
  // Empty / zero-byte (or whitespace-only) file: headers:[] lets the watcher
  // treat it as "no header row".
  const firstNonEmpty = lines.findIndex((l) => l.text.trim() !== "");
  if (firstNonEmpty === -1) return emptyResult();

  // Excel "sep=;" first line: honour as the delimiter and skip it.
  let forcedDelimiter: ";" | "," | "\t" | null = null;
  let firstCandidate = firstNonEmpty;
  const sepMatch = /^sep=(.)\s*$/i.exec(lines[firstNonEmpty].text.trim());
  if (sepMatch) {
    const d = sepMatch[1];
    if (d === ";" || d === "," || d === "\t") forcedDelimiter = d;
    firstCandidate = firstNonEmpty + 1;
    while (
      firstCandidate < lines.length &&
      lines[firstCandidate].text.trim() === ""
    ) {
      firstCandidate++;
    }
    if (firstCandidate >= lines.length) return emptyResult();
  }

  // Locate the header row.
  let headerPhys = firstCandidate;
  let delimiter = forcedDelimiter ?? detectDelimiter(lines[headerPhys].text);
  let headers = splitRow(lines[headerPhys].text, delimiter);
  let headerFound = true;
  if (opts.isHeader) {
    headerFound = false;
    let tried = 0;
    let fallback: { idx: number; d: ";" | "," | "\t"; h: string[] } | null =
      null;
    for (
      let i = firstCandidate;
      i < lines.length && tried < HEADER_SCAN_LINES;
      i++
    ) {
      if (lines[i].text.trim() === "") continue;
      tried++;
      const d = forcedDelimiter ?? detectDelimiter(lines[i].text);
      const h = splitRow(lines[i].text, d);
      if (opts.isHeader(h)) {
        headerPhys = i;
        delimiter = d;
        headers = h;
        headerFound = true;
        break;
      }
      // Best guess for diagnostics: first line that looks like a table
      // header (>= 3 non-empty cells), so a title line is not reported.
      if (!fallback && h.filter((c) => c !== "").length >= 3) {
        fallback = { idx: i, d, h };
      }
    }
    if (!headerFound) {
      const fb = fallback ?? { idx: firstCandidate, d: delimiter, h: headers };
      return {
        ...emptyResult(),
        headers: fb.h,
        delimiter: fb.d,
        headerLineIndex: fb.idx,
        preambleLines: 0,
      };
    }
  }

  // Phase B (H9): split from the header line on into LOGICAL rows honoring
  // quote state, so a newline inside a quoted cell does not end the row. Also
  // reports whether the file ended cleanly on a row terminator and whether an
  // unclosed quote forced a literal re-parse of the tail.
  const {
    rows: logicalRows,
    endsWithNewline,
    unterminatedQuote,
    literalFromRow,
  } = splitLogicalRows(text.slice(lines[headerPhys].start), delimiter);
  const headerIdx = 0;
  const cellsOf = (idx: number): string[] =>
    splitRow(logicalRows[idx], delimiter, idx >= literalFromRow);
  // A header cell may itself contain a quoted newline: re-read it from the
  // logical row.
  headers = cellsOf(0);

  // C1 + H9: a file ending mid-open-quote always has a damaged last row.
  // Optionally (tornWriteGuard, default on) a missing final terminator is
  // treated the same. Data rows only; a header-only file has nothing to
  // poison. The dropped row is flagged so the caller can say so loudly.
  const guard = opts.tornWriteGuard !== false;
  let droppedSuspectLastRow = false;
  let lastDataRow = logicalRows.length;
  const lastIdx = logicalRows.length - 1;
  // Whether the last data line has no terminator, regardless of the guard, so
  // a caller that disabled the guard can still wait for a fresh file.
  const lastLineUnterminated =
    lastIdx > headerIdx && !endsWithNewline && logicalRows[lastIdx].trim() !== "";
  if (lastIdx > headerIdx && !endsWithNewline && (unterminatedQuote || guard)) {
    lastDataRow = lastIdx;
    if (logicalRows[lastIdx].trim()) {
      droppedSuspectLastRow = true;
    }
  }
  const duplicateHeaders = findDuplicateHeaders(headers);
  const rows: Record<string, string>[] = [];
  let raggedRowCount = 0;
  let rowCapExceeded = false;
  for (let i = headerIdx + 1; i < lastDataRow; i++) {
    const line = logicalRows[i];
    if (!line.trim()) continue;
    // M-P9 part 1: enforce the row cap DURING parsing. Reaching the cap with a
    // further non-blank data line still pending means the file exceeds it, so
    // flag and stop before allocating another row object.
    if (opts.maxRows !== undefined && rows.length >= opts.maxRows) {
      rowCapExceeded = true;
      break;
    }
    const cells = cellsOf(i);
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
    lastLineUnterminated,
    raggedRowCount,
    duplicateHeaders,
    rowCapExceeded,
    headerFound,
    headerLineIndex: headerPhys,
    preambleLines: headerPhys,
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

/** Split text into physical lines (LF / CRLF / CR) with their start offsets. */
function physicalLines(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") {
      out.push({ text: text.slice(start, i), start });
      if (c === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  if (start < text.length) out.push({ text: text.slice(start), start });
  return out;
}

/**
 * Does the quote at `i` close a quoted field? Only when it is followed (after
 * optional spaces) by the delimiter, a line break or the end of the text. A
 * quote anywhere else inside a quoted field is a literal character, so
 * `"Botox 5" Nadel"` stays one field.
 */
function closesQuote(text: string, i: number, delimiter: string): boolean {
  let j = i + 1;
  while (text[j] === " ") j++;
  return j >= text.length || text[j] === delimiter || text[j] === "\n" || text[j] === "\r";
}

/**
 * Split text into LOGICAL CSV rows (RFC 4180). A quote opens a quoted field
 * ONLY at field start (start of line or right after the delimiter); inside an
 * unquoted field it is a literal character (`Botox 5" Nadel`). A quoted field
 * continues across newlines until its closing quote; `""` inside it is a
 * literal quote. Newlines OUTSIDE quotes (LF or CRLF) terminate a row.
 *
 * If the text ends inside an open quoted field, the tail from the start of the
 * row that opened it is re-split with quotes treated literally (one row per
 * physical line) instead of swallowing every following row; `literalFromRow`
 * is the index of the first such row.
 *
 * Returns:
 *   - rows: the logical row strings, each still containing its raw quotes and
 *     any embedded newlines (splitRow later turns them into cells).
 *   - endsWithNewline: the text ended on a row terminator (nothing trailing
 *     after it). Used by the torn-write guard.
 *   - unterminatedQuote: the literal fallback was needed (open quote at EOF).
 */
function splitLogicalRows(
  text: string,
  delimiter: string
): {
  rows: string[];
  endsWithNewline: boolean;
  unterminatedQuote: boolean;
  literalFromRow: number;
} {
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  let atFieldStart = true;
  let rowStart = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes) {
        if (text[i + 1] === '"') {
          cur += '""'; // escaped quote, stay in quotes
          i++;
        } else {
          if (closesQuote(text, i, delimiter)) inQuotes = false;
          cur += c;
        }
      } else {
        if (atFieldStart) inQuotes = true;
        atFieldStart = false;
        cur += c;
      }
      continue;
    }
    if (!inQuotes) {
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++; // CRLF is one break
        rows.push(cur);
        cur = "";
        atFieldStart = true;
        rowStart = i + 1;
        continue;
      }
      if (c === delimiter) {
        atFieldStart = true;
        cur += c;
        continue;
      }
      if (c !== " ") atFieldStart = false;
    }
    cur += c;
  }
  if (inQuotes) {
    // Open quote at EOF: re-parse the tail literally.
    const tail = physicalLines(text.slice(rowStart));
    return {
      rows: [...rows, ...tail.map((l) => l.text)],
      endsWithNewline: /[\r\n]$/.test(text),
      unterminatedQuote: true,
      literalFromRow: rows.length,
    };
  }
  // `cur` holds the segment after the last unquoted row terminator. Non-empty
  // (a newline-less final line) means there is a trailing logical row; push
  // it. Empty means the file ended cleanly.
  if (cur !== "") rows.push(cur);
  return {
    rows,
    endsWithNewline: cur === "",
    unterminatedQuote: false,
    literalFromRow: Infinity,
  };
}

function detectDelimiter(headerLine: string): ";" | "," | "\t" {
  // M-P2: genuinely count-based. The delimiter that occurs MOST OFTEN in the
  // header (outside quoted ranges) wins; ties break in the order ; > tab > ,
  // (German-PVS default first). If no candidate occurs, default to comma (a
  // single-column file has no delimiter to detect).
  const counts: Record<";" | "\t" | ",", number> = {
    ";": countDelimiters(headerLine, ";"),
    "\t": countDelimiters(headerLine, "\t"),
    ",": countDelimiters(headerLine, ","),
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

/** Number of delimiters outside quoted fields (quotes open at field start only). */
function countDelimiters(line: string, ch: string): number {
  return splitRaw(line, ch, false).length - 1;
}

function splitRow(line: string, delimiter: string, literal = false): string[] {
  return splitRaw(line, delimiter, literal).map((v) => v.trim());
}

/**
 * Split one logical row into cells (untrimmed). A quote opens a quoted field
 * only at field start; inside it `""` is a literal quote and a quote closes
 * the field only when followed by the delimiter or the end of the row, any
 * other quote is literal. `literal` treats every quote as a plain character.
 */
function splitRaw(line: string, delimiter: string, literal: boolean): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!literal && c === '"') {
      if (inQuotes) {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (closesQuote(line, i, delimiter)) {
          inQuotes = false;
        } else {
          cur += c;
        }
      } else if (atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
        cur = ""; // drop leading spaces before the opening quote
      } else {
        cur += c;
      }
      continue;
    }
    if (!inQuotes && c === delimiter) {
      cells.push(cur);
      cur = "";
      atFieldStart = true;
      continue;
    }
    if (c !== " " || inQuotes) atFieldStart = false;
    cur += c;
  }
  cells.push(cur);
  return cells;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
