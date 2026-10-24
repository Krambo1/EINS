import { parse as parseCsv } from "csv-parse/sync";
import { isKnownHeaderAlias } from "./pvs-csv-aliases";

/**
 * Robust parsing of a PVS CSV export: encoding detection (UTF-8/UTF-16 BOMs,
 * CP1252 fallback), delimiter detection (`sep=` line, ; , tab |), header-row
 * detection below a title/preamble, and removal of footer (Summe) lines.
 * Shared by the upload server action (preview) and the ingest worker so
 * both always see exactly the same rows.
 */

export type CsvEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "windows-1252";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  encoding: CsvEncoding;
  /** 1-based position of the header row among the non-empty lines. */
  headerRowNumber: number;
  skippedPreambleLines: number;
  skippedFooterLines: number;
}

export class CsvParseError extends Error {}

const CANDIDATES = [";", ",", "\t", "|"] as const;
const DELIMITER_SAMPLE_LINES = 20;
const HEADER_SCAN_LINES = 15;
const FOOTER_RE = /^(summe|gesamtsumme|gesamt|zwischensumme|total|endsumme|übertrag|uebertrag)(?=$|[\s:])/i;

export function decodeCsvBytes(buf: Uint8Array): {
  text: string;
  encoding: CsvEncoding;
} {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return {
      text: new TextDecoder("utf-8").decode(buf.subarray(3)),
      encoding: "utf-8-bom",
    };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return {
      text: new TextDecoder("utf-16le").decode(buf.subarray(2)),
      encoding: "utf-16le",
    };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = buf.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1]!;
      swapped[i + 1] = body[i]!;
    }
    return {
      text: new TextDecoder("utf-16le").decode(swapped),
      encoding: "utf-16be",
    };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    if (!text.includes("�")) return { text, encoding: "utf-8" };
  } catch {
    /* not valid UTF-8, fall through */
  }
  return {
    text: new TextDecoder("windows-1252").decode(buf),
    encoding: "windows-1252",
  };
}

/** Quote-aware split into logical lines (quoted fields may contain newlines). */
function splitLogicalLines(text: string, maxNonEmpty: number): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length && out.length < maxNonEmpty; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    if (!inQuote && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (cur.trim() !== "") out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "" && out.length < maxNonEmpty) out.push(cur);
  return out;
}

function countFields(line: string, delim: string): number {
  let n = 1;
  let inQuote = false;
  for (const c of line) {
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === delim) n++;
  }
  return n;
}

export function detectDelimiter(text: string): string {
  const lines = splitLogicalLines(text, DELIMITER_SAMPLE_LINES);
  let best: { delim: string; score: number; cols: number } | null = null;
  for (const delim of CANDIDATES) {
    const counts = lines.map((l) => countFields(l, delim)).filter((n) => n > 1);
    if (counts.length === 0) continue;
    const freq = new Map<number, number>();
    for (const n of counts) freq.set(n, (freq.get(n) ?? 0) + 1);
    let cols = 0;
    let score = 0;
    for (const [n, f] of freq) {
      if (f > score || (f === score && n > cols)) {
        score = f;
        cols = n;
      }
    }
    if (!best || score > best.score || (score === best.score && cols > best.cols)) {
      best = { delim, score, cols };
    }
  }
  return best?.delim ?? ",";
}

function isEmptyRecord(r: string[]): boolean {
  return r.every((c) => c === "");
}

export function parseCsvBuffer(buf: Uint8Array): ParsedCsv {
  let { text, encoding } = decodeCsvBytes(buf);

  // Excel's `sep=;` first line: honour and drop it.
  let delimiter: string | null = null;
  const sep = text.match(/^\s*sep=(.)[ \t]*(?:\r?\n|$)/i);
  if (sep) {
    delimiter = sep[1]!;
    text = text.slice(sep[0].length);
  }
  if (!delimiter) delimiter = detectDelimiter(text);

  let records: string[][];
  try {
    records = parseCsv(text, {
      delimiter,
      columns: false,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: false,
    }) as string[][];
  } catch (err) {
    throw new CsvParseError(`csv_parse_error: ${(err as Error).message}`);
  }
  records = records
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => !isEmptyRecord(r));
  if (records.length === 0) throw new CsvParseError("csv_empty");

  // Header row: first of the first 15 lines with >= 2 known aliases.
  const scan = records.slice(0, HEADER_SCAN_LINES);
  let headerIdx = scan.findIndex(
    (r) => r.filter((c) => isKnownHeaderAlias(c)).length >= 2
  );
  if (headerIdx < 0) {
    const nonEmpty = scan.map((r) => r.filter((c) => c !== "").length);
    const max = Math.max(...nonEmpty);
    const need = Math.max(2, Math.ceil(max / 2));
    headerIdx = nonEmpty.findIndex((n) => n >= need);
    if (headerIdx < 0) headerIdx = 0;
  }

  const rawHeaders = records[headerIdx]!;
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h === "" ? `Spalte ${i + 1}` : h;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  let skippedFooterLines = 0;
  const rows: Record<string, string>[] = [];
  for (const rec of records.slice(headerIdx + 1)) {
    const firstNonEmpty = rec.find((c) => c !== "") ?? "";
    const repeatedHeader =
      rec.length === rawHeaders.length && rec.every((c, i) => c === rawHeaders[i]);
    if (FOOTER_RE.test(firstNonEmpty) || repeatedHeader) {
      skippedFooterLines++;
      continue;
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = rec[i] ?? "";
    });
    rows.push(obj);
  }

  return {
    headers,
    rows,
    delimiter,
    encoding,
    headerRowNumber: headerIdx + 1,
    skippedPreambleLines: headerIdx,
    skippedFooterLines,
  };
}
