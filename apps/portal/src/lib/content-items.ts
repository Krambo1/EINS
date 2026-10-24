/**
 * Pure helpers for posts (Beiträge) in the portal: which status moves EINS
 * may make by hand in this phase, permalink checks, live/stop summary,
 * inquiry tallies per Messweg and the status groups of the admin overview.
 * The status rules themselves live in lib/content-status.ts.
 */

import {
  CONTENT_STATUS_LABELS,
  adminMovesFrom,
  canAdminMove,
  type ContentPlatformName,
  type ContentStatus,
} from "./content-status";
import { classifyAttribution } from "./sources";

// ---------------------------------------------------------------------------
// Status moves
// ---------------------------------------------------------------------------

/** Badge tone per status (@eins/ui Badge). */
export const CONTENT_STATUS_TONES: Record<ContentStatus, "neutral" | "warn" | "accent" | "good" | "bad"> = {
  entwurf: "neutral",
  zur_freigabe: "warn",
  aenderung: "warn",
  freigegeben: "accent",
  geplant: "accent",
  live: "good",
  gestoppt: "bad",
};

/**
 * Moves the admin UI offers as plain buttons. Left out:
 * - zur_freigabe: only through the Freigabe-Paket (Prüf-Schranke, Phase 4);
 * - live: a post goes live only through "Permalink eintragen";
 * - gestoppt: has its own form with a reason.
 */
export function adminOfferedMoves(from: ContentStatus): ContentStatus[] {
  return adminMovesFrom(from).filter((s) => s !== "zur_freigabe" && s !== "live" && s !== "gestoppt");
}

export const ZUR_FREIGABE_ONLY_BY_BATCH =
  "Zur Freigabe geht ein Beitrag nur über das Freigabe-Paket, nach der Prüf-Schranke.";

/** Error text for an admin status move, or null when it is allowed. */
export function checkAdminMove(from: ContentStatus, to: ContentStatus, reason?: string | null): string | null {
  if (to === "freigegeben" || to === "aenderung") {
    return "Freigeben oder Änderungen wünschen kann nur die Praxis.";
  }
  if (to === "zur_freigabe") return ZUR_FREIGABE_ONLY_BY_BATCH;
  if (to === "live") return "Live geht ein Beitrag nur über „Permalink eintragen“.";
  if (!canAdminMove(from, to)) {
    return `Von „${CONTENT_STATUS_LABELS[from]}“ nach „${CONTENT_STATUS_LABELS[to]}“ ist nicht möglich.`;
  }
  if (to === "gestoppt" && !(reason ?? "").trim()) return "Zum Stoppen bitte einen Grund angeben.";
  return null;
}

/** Title, caption and flags change only while EINS works on the post. */
export function isEditableStatus(status: ContentStatus): boolean {
  return status === "entwurf" || status === "aenderung";
}

// ---------------------------------------------------------------------------
// Permalinks
// ---------------------------------------------------------------------------

const PERMALINK_HOSTS: Record<ContentPlatformName, readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
};

const PLATFORM_NAMES: Record<ContentPlatformName, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

/** Path shapes of a single post, per platform. */
function isPostPath(platform: ContentPlatformName, host: string, path: string, search: string): boolean {
  if (platform === "instagram") {
    return /^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/.test(path) || /^\/stories\/[A-Za-z0-9._]+\/\d+\/?$/.test(path);
  }
  if (platform === "tiktok") {
    if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return /^\/[A-Za-z0-9]+\/?$/.test(path);
    return /^\/@[A-Za-z0-9._]+\/(video|photo)\/\d+\/?$/.test(path);
  }
  // Facebook permalinks come in many shapes (/<seite>/posts/…, /reel/…,
  // /watch/?v=…, /permalink.php?story_fbid=…, fb.watch/…). A single-segment
  // path is a profile or page, never one post.
  if (host === "fb.watch") return /^\/[A-Za-z0-9_-]+\/?$/.test(path);
  if (/^\/(permalink\.php|story\.php|photo\.php|photo|watch)\/?$/.test(path)) return search.length > 1;
  return path.split("/").filter(Boolean).length >= 2;
}

export type PermalinkCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * A pasted permalink, checked against the platform. https only, known host,
 * the path of one post (not a profile). Tracking query parameters are dropped
 * for Instagram and TikTok; Facebook keeps its query (story_fbid, v).
 */
export function checkPermalink(platform: ContentPlatformName, raw: string): PermalinkCheck {
  const name = PLATFORM_NAMES[platform];
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Der Permalink ist keine gültige Adresse." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Der Permalink muss mit https:// beginnen." };
  if (u.username || u.password || u.port) return { ok: false, error: "Der Permalink ist keine gültige Adresse." };
  const host = u.hostname.toLowerCase();
  if (!PERMALINK_HOSTS[platform].includes(host)) {
    return { ok: false, error: `Das ist kein ${name}-Link. Bitte den Link des Beitrags aus ${name} kopieren.` };
  }
  if (!isPostPath(platform, host, u.pathname, u.search)) {
    return { ok: false, error: `Das sieht nicht nach dem Link eines einzelnen ${name}-Beitrags aus.` };
  }
  u.hash = "";
  if (platform !== "facebook") u.search = "";
  return { ok: true, url: u.toString() };
}

/**
 * The publish day from a date input ("YYYY-MM-DD"), stored at 12:00 UTC so it
 * shows as that day in Berlin. Null when invalid, before 2020 or in the future.
 */
export function parsePublishedDay(raw: string, now: Date = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
  if (d.getUTCFullYear() < 2020) return null;
  if (d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return d;
}

// ---------------------------------------------------------------------------
// Live since / stopped
// ---------------------------------------------------------------------------

export interface PublicationLike {
  publishedAt: Date;
  stoppedAt: Date | null;
}

/**
 * Live since = first publication. Stopped = the post is "gestoppt" (latest
 * publication stop, else the last update), or every publication has stopped.
 */
export function summarizePublications(
  status: ContentStatus,
  updatedAt: Date,
  pubs: readonly PublicationLike[]
): { liveSince: Date | null; stoppedAt: Date | null } {
  let liveSince: Date | null = null;
  let lastStop: Date | null = null;
  let allStopped = pubs.length > 0;
  for (const p of pubs) {
    if (!liveSince || p.publishedAt < liveSince) liveSince = p.publishedAt;
    if (p.stoppedAt) {
      if (!lastStop || p.stoppedAt > lastStop) lastStop = p.stoppedAt;
    } else {
      allStopped = false;
    }
  }
  if (status === "gestoppt") return { liveSince, stoppedAt: lastStop ?? updatedAt };
  return { liveSince, stoppedAt: allStopped ? lastStop : null };
}

// ---------------------------------------------------------------------------
// Inquiries per Messweg
// ---------------------------------------------------------------------------

export interface InquiryTally {
  total: number;
  formular: number;
  anruf: number;
  buchung: number;
  /** Linked to the post, but not through an EINS-Messweg. */
  ohne: number;
}

export function emptyTally(): InquiryTally {
  return { total: 0, formular: 0, anruf: 0, buchung: 0, ohne: 0 };
}

/** Rows grouped by (post, requests.source) → tally per post. Spam is filtered by the caller. */
export function tallyInquiries(
  rows: ReadonlyArray<{ contentItemId: string; source: string; n: number }>
): Map<string, InquiryTally> {
  const out = new Map<string, InquiryTally>();
  for (const r of rows) {
    const t = out.get(r.contentItemId) ?? emptyTally();
    const n = Number(r.n) || 0;
    const messweg = classifyAttribution({ source: r.source }).messweg;
    t.total += n;
    if (messweg) t[messweg] += n;
    else t.ohne += n;
    out.set(r.contentItemId, t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Admin overview groups
// ---------------------------------------------------------------------------

export const OVERVIEW_GROUPS: ReadonlyArray<{ key: string; label: string; statuses: readonly ContentStatus[] }> = [
  { key: "entwurf", label: "Entwurf", statuses: ["entwurf"] },
  { key: "zur_freigabe", label: "Wartet auf Freigabe", statuses: ["zur_freigabe"] },
  { key: "aenderung", label: "Änderung gewünscht", statuses: ["aenderung"] },
  { key: "freigegeben", label: "Freigegeben oder geplant", statuses: ["freigegeben", "geplant"] },
  { key: "live", label: "Live", statuses: ["live"] },
  { key: "gestoppt", label: "Gestoppt", statuses: ["gestoppt"] },
];

/** Items into the overview groups, in group order; input order is kept inside a group. */
export function groupByOverviewStatus<T extends { status: string }>(
  items: readonly T[]
): Array<{ key: string; label: string; items: T[] }> {
  return OVERVIEW_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: items.filter((i) => (g.statuses as readonly string[]).includes(i.status)),
  }));
}
