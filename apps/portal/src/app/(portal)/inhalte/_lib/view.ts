import { Clapperboard, Film, Image as ImageIcon, Images, Smartphone, type LucideIcon } from "lucide-react";
import type { ContentStatus } from "@/lib/content-status";

/**
 * What the Inhalte page hands its client cards: plain, serialisable rows
 * built on the server (dates already formatted, file URLs already signed).
 */

/** A post that waits for the Praxis' decision, as the "Zur Freigabe" card shows it. */
export type WaitingPost = {
  id: string;
  title: string;
  formatLabel: string;
  treatment: string | null;
  usesClone: boolean;
  caption: string | null;
  preview: { url: string; isVideo: boolean } | null;
  /** Latest approval of the post; null while the e-mail has not gone out. */
  approvalId: string | null;
  /** "Dienstag, 13.10.2026": last day of the batch. */
  dueLabel: string | null;
  /** An earlier decision is on record (first wins). */
  decided: boolean;
  /** Only the Inhaber:in decides posts with the KI-Klon. */
  inhaberOnly: boolean;
  canDecide: boolean;
};

/** The video or picture of a post, links already signed. */
export type PostFile = {
  url: string;
  /** Saves under the post's title (Content-Disposition, works on R2 links too). */
  downloadUrl: string;
  thumbUrl: string | null;
  isVideo: boolean;
  /** "Video · 24,3 MB · Fassung 2" */
  facts: string;
};

/** One post of the "Alle Beiträge" table, drafts left out. */
export type PostRow = {
  id: string;
  title: string;
  /** Picks the icon of a post without a picture. */
  format: string;
  formatLabel: string;
  status: ContentStatus;
  file: PostFile | null;
  /** Date the current state began: live since, stopped on, else last change. */
  since: string;
  /** Anfragen the post brought; null while it was never online. */
  anfragen: number | null;
  /** "2 Formular · 1 Anruf" */
  channels: string | null;
  changeText: string | null;
  /** "Freigegeben am 28.10.2026 von Dr. Martin Demo" */
  decision: string | null;
  stopReason: string | null;
  caption: string | null;
  links: Array<{ label: string; href: string }>;
  dueLabel: string | null;
  waiting: boolean;
};

/** Status as a dot and plain text (DESIGN.md section 5: no pills). */
export const POST_STATUS: Record<ContentStatus, { label: string; dot: string }> = {
  entwurf: { label: "Entwurf", dot: "bg-fg-tertiary" },
  zur_freigabe: { label: "Wartet auf Freigabe", dot: "bg-tone-warn" },
  aenderung: { label: "Wird überarbeitet", dot: "bg-tone-warn" },
  freigegeben: { label: "Freigegeben", dot: "bg-accent" },
  geplant: { label: "Geplant", dot: "bg-accent" },
  live: { label: "Live", dot: "bg-tone-good" },
  gestoppt: { label: "Gestoppt", dot: "bg-tone-bad" },
};

/** The icon of a post's format, where it has no picture (Übersicht and Inhalte). */
export const FORMAT_ICON: Record<string, LucideIcon> = {
  reel: Clapperboard,
  video: Film,
  karussell: Images,
  bild: ImageIcon,
  story: Smartphone,
};
