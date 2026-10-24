/**
 * Shared money-amount parsing for the UK/API adapters (Pabau, Consentz).
 *
 * Both adapters historically carried an identical `coerceAmountCents` that
 * (a) trusted a naive `.replace(",", ".")` locale conversion, which turned
 * "1.234,50" into 123 cents (dots survived, first comma became the decimal
 * point), under-counting any invoice >= 1000 EUR by ~1000x (H3), and
 * (b) dropped negative amounts as noise, so a Storno / Gutschrift could never
 * become an InvoiceRefunded (H1).
 *
 * This module fixes both in one place:
 *   - last-separator-wins locale parsing (replicated from the agent's
 *     db-adapters/normalizer.ts normaliseDecimalString, kept in sync by
 *     contract, not imported across the app boundary), and
 *   - SIGNED cents output so the caller can route negatives to a refund.
 *
 * A plausibility guard logs (with a running count) any single-invoice amount
 * outside 0 < x <= 100_000 EUR. It never drops the value: a large procedure is
 * legitimate, and silently discarding it would understate revenue. The count
 * lets an operator spot a systematic parse/locale defect.
 */

let implausibleAmountCount = 0;

/** Test/inspection accessor for the plausibility counter. */
export function getImplausibleAmountCount(): number {
  return implausibleAmountCount;
}

/** Test helper: reset the plausibility counter between cases. */
export function resetImplausibleAmountCount(): void {
  implausibleAmountCount = 0;
}

/**
 * Guard a computed cents value against the 0 < x <= 100_000 EUR plausibility
 * window. Warns + counts when outside; always returns the value unchanged.
 */
export function guardAmountCents(cents: number, raw?: unknown): number {
  const abs = Math.abs(cents);
  if (abs === 0 || abs > 100_000 * 100) {
    implausibleAmountCount++;
    console.warn(
      `[adapter-amount] implausible invoice amount ${JSON.stringify(
        raw ?? cents
      )} -> ${cents} cents (expected 0 < x <= 100000 EUR); count=${implausibleAmountCount}`
    );
  }
  return cents;
}

/**
 * Parse a money value into SIGNED integer cents.
 *
 *   - number: treated as major units (EUR), e.g. 199.5 -> 19950.
 *   - string: localized; last-separator-wins decides the decimal separator.
 *
 * Returns null only when the value is structurally unparseable. Negative
 * results are preserved so the caller can emit InvoiceRefunded.
 */
export function parseSignedAmountToCents(raw: number | string): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return guardAmountCents(Math.round(raw * 100), raw);
  }
  const cleaned = String(raw)
    .replace(/EUR/gi, "")
    .replace(/€/g, "")
    .replace(/\s/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[-+]/, "");
  const normalised = normaliseDecimalString(unsigned);
  if (normalised === undefined) return null;
  const num = Number(normalised);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100) * (negative ? -1 : 1);
  return guardAmountCents(cents, raw);
}

/**
 * Turn a localized money string (unsigned) into a plain JS-number string.
 * Rule table (matches db-adapters/normalizer.ts):
 *
 *   "1.234"    -> "1234"     (lone separator + exactly 3 digits -> thousands)
 *   "1,250"    -> "1250"     (same rule -> 1250 EUR, not 1.25)
 *   "1.50"     -> "1.50"     (<=2 trailing digits -> decimal)
 *   "1234,5"   -> "1234.5"
 *   "1.234,56" -> "1234.56"  (two separator types -> the LAST is the decimal)
 *   "1,250.00" -> "1250.00"
 *   "1.234.567"-> "1234567"  (repeated separator -> all grouping)
 */
export function normaliseDecimalString(s: string): string | undefined {
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    return s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  }

  const sep = hasComma ? "," : hasDot ? "." : "";
  if (sep === "") return s;

  const parts = s.split(sep);
  if (parts.length > 2) return parts.join("");
  const trailing = parts[1] ?? "";
  return trailing.length === 3 ? parts[0] + trailing : `${parts[0]}.${trailing}`;
}

/** Statuses that mean "no money was kept", whatever a paid_at field says. */
const NOT_PAID_STATUSES: ReadonlySet<string> = new Set([
  "void",
  "voided",
  "cancelled",
  "canceled",
  "refunded",
  "draft",
  "failed",
]);

/**
 * Is this invoice / payment row paid? A void-like status always wins: vendors
 * keep the old paid_at on an invoice that was voided afterwards, and counting it
 * would book revenue that was never kept. paid_at decides only when the status
 * is empty or not one we know.
 */
export function isPaidRow(
  status: string | null | undefined,
  paidAt: string | null | undefined,
  paidStatuses: ReadonlySet<string>
): boolean {
  const s = (status ?? "").trim().toLowerCase();
  if (NOT_PAID_STATUSES.has(s)) return false;
  if (paidStatuses.has(s)) return true;
  return !!paidAt;
}

/**
 * The vendor's currency as read (upper case); a missing one is EUR, the DACH
 * default. Anything other than EUR or CHF is deliberately NOT mapped to EUR: it
 * goes on as read and the sanitiser rejects the event (unsupported_currency), so
 * a USD or GBP amount can never be booked as euros. The cast only exists because
 * the event type is narrowed to the two supported values.
 */
export function vendorCurrency(raw: string | null | undefined): "EUR" | "CHF" {
  const c = (raw ?? "").trim().toUpperCase();
  return (c === "" ? "EUR" : c) as "EUR" | "CHF";
}

/** First non-blank id among the candidates (a credit note's reference to the
 *  invoice it belongs to), as a string. */
export function firstRef(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return undefined;
}
