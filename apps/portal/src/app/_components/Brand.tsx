import type { ReactNode } from "react";
import { ClipboardList, PenLine, type LucideIcon } from "lucide-react";

export type BrandKey =
  | "google"
  | "jameda"
  | "meta"
  | "formular"
  | "manuell";

const SIMPLE_LOGOS: Partial<Record<BrandKey, string>> = {
  google: "/Google_Favicon_2025.svg",
  jameda: "/jameda-logo.png",
};

const ICONS: Partial<Record<BrandKey, LucideIcon>> = {
  formular: ClipboardList,
  manuell: PenLine,
};

const LABELS: Record<BrandKey, string> = {
  google: "Google",
  jameda: "Jameda",
  meta: "Meta",
  formular: "Zielseiten-Formular",
  manuell: "Manueller Eintrag",
};

const META_LIGHT = "/Meta_lockup_positive primary_RGB.svg";
const META_DARK = "/Meta_lockup_negative primary_white_RGB.svg";

const baseImg = "inline-block h-[1em] w-auto shrink-0 align-[-0.15em]";
const metaImg = "inline-block h-[2em] w-auto shrink-0 align-[-0.55em]";
const baseIcon = "inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em]";

export function BrandLogo({
  brand,
  className = "",
}: {
  brand: BrandKey;
  className?: string;
}) {
  if (brand === "meta") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={META_LIGHT}
          alt=""
          aria-hidden="true"
          className={`brand-meta-light ${metaImg} ${className}`}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={META_DARK}
          alt=""
          aria-hidden="true"
          className={`brand-meta-dark ${metaImg} ${className}`}
        />
      </>
    );
  }

  const Icon = ICONS[brand];
  if (Icon) {
    return (
      <Icon
        aria-hidden="true"
        className={`brand-source-icon ${baseIcon} ${className}`}
      />
    );
  }

  const src = SIMPLE_LOGOS[brand];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={`${baseImg} ${className}`}
    />
  );
}

/**
 * Inline brand mention — renders the text followed by its logo, sized to 1em.
 * Use sparingly: only where naming the brand visually matters (labels, table
 * cells, card titles, platform tiles). Don't sprinkle into flowing prose.
 */
export function Brand({
  brand,
  children,
}: {
  brand: BrandKey;
  children?: ReactNode;
}) {
  if (brand === "meta") {
    // The Meta lockup already includes the "Meta" wordmark, so strip a
    // leading "Meta" from the label to avoid rendering the name twice.
    const label = children ?? LABELS[brand];
    let suffix: ReactNode = null;
    if (typeof label === "string") {
      const stripped = label.replace(/^Meta\s*/, "");
      if (stripped) suffix = stripped;
    } else if (label) {
      suffix = label;
    }
    return (
      <span className="whitespace-nowrap">
        <BrandLogo brand={brand} />
        {suffix ? <span className="ml-1">{suffix}</span> : null}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      {children ?? LABELS[brand]}
      <BrandLogo brand={brand} className="ml-1" />
    </span>
  );
}

/**
 * Direct source → brand-decorated label. Avoids the regex-split + variadic
 * <Brand> render that `withBrandLogos` produces, which is expensive for
 * list pages that render this once per row (e.g. /anfragen).
 *
 * Falls back to a plain text label for sources without a registered brand
 * (today: `whatsapp`).
 */
const SOURCE_TO_BRAND: Record<string, BrandKey> = {
  meta: "meta",
  google: "google",
  formular: "formular",
  manuell: "manuell",
  jameda: "jameda",
};

export function SourceLabel({
  source,
  label,
}: {
  source: string;
  label: string;
}) {
  const brand = SOURCE_TO_BRAND[source];
  if (!brand) return <>{label}</>;
  return <Brand brand={brand}>{label}</Brand>;
}

const BRAND_PATTERN =
  /(Google Ads|Google Maps|Google Authenticator|Google|Jameda|Meta|Zielseiten-Formular|Manueller Eintrag)/g;

/**
 * Walk a plain string and wrap any "Google", "Jameda", "Meta" (and common
 * Google sub-brands) with an inline <Brand> showing the logo next to the
 * text. Use this for short labels coming from constants dicts, not for
 * flowing prose.
 */
export function withBrandLogos(text: string): ReactNode {
  const parts = text.split(BRAND_PATTERN);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const brand: BrandKey = part.startsWith("Google")
      ? "google"
      : part === "Jameda"
        ? "jameda"
        : part === "Zielseiten-Formular"
          ? "formular"
          : part === "Manueller Eintrag"
            ? "manuell"
            : "meta";
    return (
      <Brand key={i} brand={brand}>
        {part}
      </Brand>
    );
  });
}

/**
 * Icon-only variant of {@link withBrandLogos}: renders just the brand logo(s)
 * for any recognised token in `text` and drops the surrounding words. Used in
 * tight layouts (e.g. the mobile Quellen-Aufschlüsselung) where the source is
 * conveyed by its logo alone and the text label would steal column width.
 *
 * Falls back to the plain text when no brand matches (e.g. "WhatsApp"), so an
 * unbranded source never collapses to nothing.
 */
export function brandIconsOnly(text: string): ReactNode {
  const parts = text.split(BRAND_PATTERN);
  const logos: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) return; // even indices are the non-brand text, dropped
    const brand: BrandKey = part.startsWith("Google")
      ? "google"
      : part === "Jameda"
        ? "jameda"
        : part === "Zielseiten-Formular"
          ? "formular"
          : part === "Manueller Eintrag"
            ? "manuell"
            : "meta";
    logos.push(<BrandLogo key={i} brand={brand} />);
  });
  return logos.length > 0 ? logos : text;
}
