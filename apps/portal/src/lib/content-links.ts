/**
 * Link builder for posts (Beiträge): the tagged links EINS uses so an
 * inquiry carries the post it came from (playbook O1 to O3, UTM convention in
 * lib/sources.ts). Pure.
 *
 * All links point at the practice start page (clinic-landing
 * `[clinicSlug]/page.tsx`, the bare domain of the Zielseite) and carry no
 * treatment and no campaign name: utm_source and utm_medium plus the opaque
 * post code in utm_content, which clinic-landing keeps in the URL (D6).
 */

import { isPostCode } from "./post-code";

export const CONTENT_LINK_MEDIA = ["profil_link", "dm", "story_link", "organisch"] as const;
export type ContentLinkMedium = (typeof CONTENT_LINK_MEDIA)[number];

export const CONTENT_LINK_MEDIUM_LABELS: Record<ContentLinkMedium, string> = {
  profil_link: "Profil-Link (für alle Beiträge gleich)",
  dm: "Link für Direktnachrichten",
  story_link: "Link-Sticker in der Story",
  organisch: "Link im Beitragstext (Facebook, TikTok)",
};

/** utm_medium per link; each value is one the channel classifier knows. */
const MEDIUM_UTM: Record<ContentLinkMedium, string> = {
  profil_link: "profil_link",
  dm: "dm",
  story_link: "story",
  organisch: "organisch",
};

export type ContentPlatform = "instagram" | "facebook" | "tiktok";

/**
 * Origin of the practice's Zielseite ("https://praxis-x.de"), or null when it
 * is not a plain https origin.
 */
export function zielseiteOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function buildContentLink(input: {
  origin: string;
  code: string;
  medium: ContentLinkMedium;
  platform?: ContentPlatform;
}): string {
  if (!isPostCode(input.code)) throw new Error("invalid_post_code");
  const url = new URL("/", input.origin);
  url.searchParams.set("utm_source", input.platform ?? "instagram");
  url.searchParams.set("utm_medium", MEDIUM_UTM[input.medium]);
  // The profile link is the same for every post: it carries no post code.
  if (input.medium !== "profil_link") url.searchParams.set("utm_content", input.code);
  return url.toString();
}

/** All links of one post, in display order. */
export function buildContentLinks(origin: string, code: string): Array<{ medium: ContentLinkMedium; url: string }> {
  return CONTENT_LINK_MEDIA.map((medium) => ({ medium, url: buildContentLink({ origin, code, medium }) }));
}
