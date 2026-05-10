import type { Address, PriceRange } from "./types";

export function formatPriceRange(range: PriceRange): string {
  const fmt = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: range.currency,
    maximumFractionDigits: 0,
  });
  const from = fmt.format(range.fromCents / 100);
  if (range.toCents === undefined) return `ab ${from}`;
  const to = fmt.format(range.toCents / 100);
  return `${from} – ${to}`;
}

export function formatAddress(addr: Address): string {
  return `${addr.street}, ${addr.zip} ${addr.city}`;
}

export function whatsappLink(digits: string, prefilled?: string): string {
  const text = prefilled ? `?text=${encodeURIComponent(prefilled)}` : "";
  return `https://wa.me/${digits}${text}`;
}

export function telLink(e164: string): string {
  return `tel:${e164}`;
}

export function mailLink(email: string, subject?: string): string {
  const s = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${email}${s}`;
}

/** Hex → rgb, used to derive CSS-var tints in the layout. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "");
  const norm =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(norm)) return null;
  return {
    r: parseInt(norm.slice(0, 2), 16),
    g: parseInt(norm.slice(2, 4), 16),
    b: parseInt(norm.slice(4, 6), 16),
  };
}

/** Radius style → concrete CSS rem value used as `--brand-radius`. */
export function radiusToCss(radius: "sharp" | "soft" | "pill"): string {
  switch (radius) {
    case "sharp":
      return "0.125rem";
    case "soft":
      return "0.75rem";
    case "pill":
      return "1.5rem";
  }
}
