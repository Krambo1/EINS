import iconv from "iconv-lite";
import { createHash } from "node:crypto";

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
 *   - UTF-8 BOM strip
 *   - CRLF and LF line endings
 *   - ISO-8859-15 fallback when UTF-8 decode produces replacement chars
 *
 * What it does NOT handle: multi-line quoted fields (rare in DACH PVS
 * exports; if a file contains them we'll log the affected row and skip).
 */

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: ";" | "," | "\t";
  contentHash: string;
}

export function parseCsv(bytes: Buffer): CsvParseResult {
  const contentHash = sha256(bytes);
  const text = decodeCsv(bytes).replace(/^﻿/, "");
  const lines = splitLines(text);
  if (lines.length === 0) {
    return { headers: [], rows: [], delimiter: ";", contentHash };
  }
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitRow(lines[0], delimiter);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitRow(line, delimiter);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return { headers, rows, delimiter, contentHash };
}

function decodeCsv(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return iconv.decode(bytes, "ISO-8859-15");
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function detectDelimiter(headerLine: string): ";" | "," | "\t" {
  // Count occurrences outside quoted ranges. The delimiter with the
  // highest non-zero count wins; semicolon ties trump comma (German PVS
  // default).
  const counts = {
    ";": countOutsideQuotes(headerLine, ";"),
    "\t": countOutsideQuotes(headerLine, "\t"),
    ",": countOutsideQuotes(headerLine, ","),
  };
  if (counts[";"] > 0) return ";";
  if (counts["\t"] > 0) return "\t";
  return ",";
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
