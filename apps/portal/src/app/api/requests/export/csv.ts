/**
 * CSV for German Excel: UTF-8 with BOM (so umlauts open correctly),
 * semicolon separator, CRLF line ends. Text cells that a spreadsheet would
 * read as a formula (= + - @, also after leading tab/CR) get a leading
 * apostrophe, so a patient name like "=HYPERLINK(...)" stays text (formula
 * injection).
 *
 * Phone numbers (V2 Neben 1): a cell made only of digits, spaces and
 * + ( ) / . - cannot carry a function, a cell reference or a DDE call, so it
 * gets no apostrophe (Excel and LibreOffice show it literally in a CSV).
 * Phone-like cells a spreadsheet would turn into a number or a calculation
 * ("+491701234567" becomes 4,917E+11, "+49-170-1234567" is computed,
 * "01701234567" loses its 0) are written as the constant text formula
 * ="+491701234567": Excel (German locale, semicolon CSV, checked by opening
 * the file) shows +491701234567 as plain text, LibreOffice does the same with
 * "Formeln auswerten" on in its import dialog. Phone cells with a space,
 * slash or bracket that do not start with + or - ("0170 1234567") stay
 * unchanged, both read them as text. Real numbers are never touched.
 */

/** Only digits, spaces and + ( ) / . -, with at least one digit. */
const PHONE_LIKE = /^(?=.*\d)[\d +()/.-]+$/;
/** Phone-like values a spreadsheet would read as a number or a calculation. */
const NEEDS_TEXT_FORMULA = /^[+-]|^[\d.]+$/;

const BOM = "﻿";

export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  let s = value;
  if (PHONE_LIKE.test(s)) {
    if (NEEDS_TEXT_FORMULA.test(s)) s = `="${s}"`;
  } else if (/^[\t\r]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>
): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return BOM + lines.join("\r\n") + "\r\n";
}
