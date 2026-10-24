/**
 * Post (Beitrag) status rules. Pure. "Kein Beitrag ohne Ihre Freigabe"
 * (KANON § 5, § 6) lives here as code:
 *
 *   entwurf ──(Prüf-Schranke, admin)──▶ zur_freigabe
 *   zur_freigabe ──(Praxis decides)──▶ freigegeben | aenderung
 *   aenderung ──(admin edits)──▶ entwurf ──▶ zur_freigabe …
 *   freigegeben ──▶ geplant ──▶ live      (admin; live via permalink)
 *   any except gestoppt ──▶ gestoppt     (admin, with a reason)
 *
 * Nobody but the Praxis moves a post to "freigegeben" or "aenderung", and
 * there is no automatic approval. A post can only go live after approval.
 */

export const CONTENT_STATUSES = [
  "entwurf",
  "zur_freigabe",
  "aenderung",
  "freigegeben",
  "geplant",
  "live",
  "gestoppt",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_FORMATS = ["reel", "story", "karussell", "bild", "video"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_PLATFORMS = ["instagram", "facebook", "tiktok"] as const;
export type ContentPlatformName = (typeof CONTENT_PLATFORMS)[number];

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  entwurf: "Entwurf",
  zur_freigabe: "Wartet auf Freigabe",
  aenderung: "Änderung gewünscht",
  freigegeben: "Freigegeben",
  geplant: "Geplant",
  live: "Live",
  gestoppt: "Gestoppt",
};

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  reel: "Reel",
  story: "Story",
  karussell: "Karussell",
  bild: "Bild",
  video: "Video",
};

/** Moves EINS (admin) may make by hand. zur_freigabe needs the gate on top (Phase 4). */
const ADMIN_MOVES: Record<ContentStatus, readonly ContentStatus[]> = {
  entwurf: ["zur_freigabe", "gestoppt"],
  zur_freigabe: ["entwurf", "gestoppt"],
  aenderung: ["entwurf", "gestoppt"],
  freigegeben: ["geplant", "live", "gestoppt"],
  geplant: ["live", "gestoppt"],
  live: ["gestoppt"],
  gestoppt: [],
};

/** Moves only the Praxis makes, through its approval decision. */
const PRAXIS_MOVES: Record<ContentStatus, readonly ContentStatus[]> = {
  entwurf: [],
  zur_freigabe: ["freigegeben", "aenderung"],
  aenderung: [],
  freigegeben: [],
  geplant: [],
  live: [],
  gestoppt: [],
};

export function isContentStatus(v: unknown): v is ContentStatus {
  return typeof v === "string" && (CONTENT_STATUSES as readonly string[]).includes(v);
}

export function canAdminMove(from: ContentStatus, to: ContentStatus): boolean {
  return ADMIN_MOVES[from].includes(to);
}

export function canPraxisDecide(from: ContentStatus, to: ContentStatus): boolean {
  return PRAXIS_MOVES[from].includes(to);
}

/** Admin moves offered in the UI for a post in `from`. */
export function adminMovesFrom(from: ContentStatus): readonly ContentStatus[] {
  return ADMIN_MOVES[from];
}

/** A publication (permalink) may only be added once the Praxis has approved. */
export function canPublish(status: ContentStatus): boolean {
  return status === "freigegeben" || status === "geplant" || status === "live";
}
