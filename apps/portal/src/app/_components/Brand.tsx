import type { ReactNode } from "react";
import {
  ClipboardList,
  Database,
  Facebook,
  Globe,
  Instagram,
  Link as LinkIcon,
  MessageCircle,
  PenLine,
  Send,
  Users,
  type LucideIcon,
} from "lucide-react";

export type BrandKey =
  | "google"
  | "jameda"
  | "meta"
  | "formular"
  | "manuell"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "profil_link"
  | "dm_link"
  | "direkt"
  | "whatsapp"
  | "empfehlung"
  | "pvs_import";

const SIMPLE_LOGOS: Partial<Record<BrandKey, string>> = {
  google: "/Google_Favicon_2025.svg",
  jameda: "/jameda-logo.png",
  // The official TikTok note (cyan and red behind black), not a stand-in icon.
  tiktok: "/tiktok-logo.png",
};

const ICONS: Partial<Record<BrandKey, LucideIcon>> = {
  formular: ClipboardList,
  manuell: PenLine,
  instagram: Instagram,
  facebook: Facebook,
  profil_link: LinkIcon,
  dm_link: Send,
  direkt: Globe,
  whatsapp: MessageCircle,
  empfehlung: Users,
  pvs_import: Database,
};

// The organic labels are the exact Quellen bucket names (lib/sources.ts), so
// "Meta / Instagram" and other mentions of a platform stay as they are.
const LABELS: Record<BrandKey, string> = {
  google: "Google",
  jameda: "Jameda",
  meta: "Meta",
  formular: "Zielseiten-Formular",
  manuell: "Manueller Eintrag",
  instagram: "Instagram-Beitrag",
  facebook: "Facebook-Beitrag",
  tiktok: "TikTok-Beitrag",
  profil_link: "Profil-Link",
  dm_link: "Link aus Direktnachricht",
  direkt: "Direkt (ohne Kennzeichnung)",
  whatsapp: "WhatsApp",
  empfehlung: "Empfehlung",
  pvs_import: "PVS-Import",
};

const BRAND_BY_LABEL: Record<string, BrandKey> = Object.fromEntries(
  Object.entries(LABELS).map(([key, label]) => [label, key as BrandKey])
);

// Symbol only (the infinity mark), cropped from the official lockup, so Meta
// reads like every other source: logo first, then the name as plain text.
const META_SYMBOL = "/meta-symbol.svg";

const baseImg = "inline-block h-[1em] w-auto shrink-0 align-[-0.15em]";
// The Meta mark is half again as wide as it is tall, so at full height it
// looked too big beside the square logos: 85 %, still centred on the text.
const metaImg = "inline-block h-[0.85em] w-auto shrink-0 align-[-0.075em]";
const baseIcon = "inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em]";

export function BrandLogo({
  brand,
  className = "",
}: {
  brand: BrandKey;
  className?: string;
}) {
  const Icon = ICONS[brand];
  if (Icon) {
    return (
      <Icon
        aria-hidden="true"
        className={`brand-source-icon ${baseIcon} ${className}`}
      />
    );
  }

  const src = brand === "meta" ? META_SYMBOL : SIMPLE_LOGOS[brand];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={`${brand === "meta" ? metaImg : baseImg} ${className}`}
    />
  );
}

/**
 * Inline brand mention: the logo first, then the name, sized to 1em. Same
 * order for every source (Google, Meta, Jameda, Formular, manuell, the
 * organic channels), so a column of sources lines up. Use sparingly: labels,
 * table cells, card titles, platform tiles. Don't sprinkle into flowing prose.
 */
export function Brand({
  brand,
  children,
}: {
  brand: BrandKey;
  children?: ReactNode;
}) {
  return (
    <span className="whitespace-nowrap">
      <BrandLogo brand={brand} className="mr-1" />
      {children ?? LABELS[brand]}
    </span>
  );
}

const BRAND_PATTERN =
  /(Google Ads|Google Maps|Google Authenticator|Google|Jameda|Meta|Zielseiten-Formular|Manueller Eintrag|Instagram-Beitrag|Facebook-Beitrag|TikTok-Beitrag|Profil-Link|Link aus Direktnachricht|Direkt \(ohne Kennzeichnung\)|WhatsApp|Empfehlung|PVS-Import)/g;

/**
 * Walk a plain string and wrap any "Google", "Jameda", "Meta" (and common
 * Google sub-brands) or a Quellen bucket name with an inline <Brand> showing
 * the logo or icon next to the text. Use this for short labels coming from
 * constants dicts, not for flowing prose.
 */
export function withBrandLogos(text: string): ReactNode {
  const parts = text.split(BRAND_PATTERN);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const brand: BrandKey = part.startsWith("Google") ? "google" : BRAND_BY_LABEL[part] ?? "meta";
    return (
      <Brand key={i} brand={brand}>
        {part}
      </Brand>
    );
  });
}
