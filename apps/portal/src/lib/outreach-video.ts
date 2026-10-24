import { z } from "zod";

/**
 * Pure helpers for the outreach video pages on eins.ag/v/<slug>. The DB and
 * storage side lives in `@/server/outreach-videos`; everything here is
 * deterministic so it can be unit-tested without Postgres or R2. Client-safe:
 * the admin upload card imports it, so no node built-ins here (the viewer
 * hash lives in `./outreach-video-hash`).
 */

/** No 0/o, 1/l/i: a slug read aloud or typed from a screenshot stays correct. */
export const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const SLUG_LENGTH = 10;
export const SLUG_PATTERN = new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`);

/** Formats the admin upload accepts. The browser playability check decides the rest. */
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "mov"] as const;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB, same cap as client uploads
export const MAX_POSTER_BYTES = 5 * 1024 * 1024;

/** Storage prefix. Clinic uploads live under `<clinicId>/`, so this cannot collide. */
export const VIDEO_KEY_PREFIX = "outreach-videos/";

/** Watch milestones the player reports. Anything else is rejected. */
export const MILESTONES = [10, 25, 50, 75, 90, 100] as const;

export const EVENT_KINDS = ["open", "play", "progress", "cta"] as const;

/**
 * Beacon body. Short keys because `navigator.sendBeacon` fires on every
 * milestone; `s` is the per-page-load session id the browser generates.
 */
export const VideoEventInput = z
  .object({
    k: z.enum(EVENT_KINDS),
    s: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    p: z.number().int().optional(),
    i: z.boolean().optional(),
  })
  .refine(
    (e) =>
      e.k === "progress"
        ? (MILESTONES as readonly number[]).includes(e.p ?? -1)
        : e.p === undefined || e.p === 0,
    { message: "percent only allowed on progress, and only as a milestone" }
  );
export type VideoEventInput = z.infer<typeof VideoEventInput>;

/** Parse a beacon body (sendBeacon sends text/plain). Null on anything invalid. */
export function parseVideoEvent(raw: string): VideoEventInput | null {
  if (raw.length > 512) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = VideoEventInput.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export type Device = "mobile" | "tablet" | "desktop";

/** Coarse device class from the user agent. The raw UA is never stored. */
/**
 * G-18: link scanners and preview bots that open a mailed link (Microsoft
 * Safe Links, Proofpoint, Mimecast, Barracuda, headless browsers, link
 * previews). Their beacons are stored as internal so they never count as a
 * view. A scanner with a plain desktop UA is not caught by this.
 */
const SCANNER_UA =
  /headless|bot\b|bot\/|crawler|spider|slurp|preview|scanner|safelinks|proofpoint|mimecast|barracuda|forcepoint|symantec|trendmicro|cisco|fortiguard|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|java\/|phantomjs|puppeteer|playwright|lighthouse|facebookexternalhit|whatsapp|slackbot|telegrambot|discordbot|linkedinbot|skypeuripreview|googleimageproxy/i;

export function isLikelyScanner(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length === 0) return true;
  return SCANNER_UA.test(ua);
}

export function deviceFromUserAgent(ua: string | null | undefined): Device {
  const s = (ua ?? "").toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android/.test(s)) return "mobile";
  return "desktop";
}

export function publicVideoUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/v/${slug}`;
}

/** Lowercased extension, or "" if none. */
export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

export function isVideoExtension(ext: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export const OBSIDIAN_VAULT = "Karam";

const LEAD_ID_PATTERN = /^[0-9a-f]{32}$/;
const DASHED_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function obsidianOpenUri(notePath: string): string {
  return `obsidian://open?vault=${OBSIDIAN_VAULT}&file=${encodeURIComponent(notePath)}`;
}

/**
 * What the Obsidian field stores, from whatever gets pasted:
 *  - an `obsidian://open?vault=Karam&file=...` URI (kept as is),
 *  - a `[[wikilink]]` or a vault-relative note path (turned into that URI,
 *    without the .md),
 *  - a lead-id: the bare 32-hex id or a dashed UUID (stored as 32 lowercase hex).
 * Anything else returns null.
 */
export function normalizeObsidianRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  if (/^obsidian:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.hostname !== "open") return null;
      if (u.searchParams.get("vault") !== OBSIDIAN_VAULT) return null;
      if (!u.searchParams.get("file")?.trim()) return null;
      return s;
    } catch {
      return null;
    }
  }

  const lower = s.toLowerCase();
  if (LEAD_ID_PATTERN.test(lower)) return lower;
  if (DASHED_UUID_PATTERN.test(lower)) return lower.replace(/-/g, "");

  let path = s;
  const wiki = s.match(/^\[\[([^\]]+)\]\]$/);
  if (wiki) path = wiki[1]!.split("|")[0]!.split("#")[0]!;
  else if (!/\.md$/i.test(s) && !s.includes("/")) return null;

  path = path.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
  if (!path || /^[a-z]:/i.test(path) || path.startsWith("/") || path.includes("://")) return null;
  if (path.split("/").some((seg) => seg === ".." || seg === "")) return null;
  return obsidianOpenUri(path);
}

/** Link target for a stored value: the URI itself, or a property search for a lead-id. */
export function obsidianHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("obsidian://")) return normalizeObsidianRef(ref);
  if (LEAD_ID_PATTERN.test(ref)) {
    return `obsidian://search?vault=${OBSIDIAN_VAULT}&query=${encodeURIComponent(`["lead-id":${ref}]`)}`;
  }
  return null;
}

/** "4:07" */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
