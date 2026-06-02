import type { ReactNode } from "react";
import { Brand } from "@/app/_components/Brand";

export const TRACKED_PLATFORMS = ["google", "jameda", "manual"] as const;

export type Platform = (typeof TRACKED_PLATFORMS)[number];

export function platformLabel(p: Platform | string): string {
  switch (p) {
    case "google":
      return "Google";
    case "jameda":
      return "Jameda";
    case "manual":
      return "Eigene Aufnahme";
    default:
      return p;
  }
}

/** JSX variant — renders the platform name with its logo inline. */
export function platformLabelNode(p: Platform | string): ReactNode {
  switch (p) {
    case "google":
      return <Brand brand="google" />;
    case "jameda":
      return <Brand brand="jameda" />;
    default:
      return platformLabel(p);
  }
}

/** Button-Beschriftung pro Plattform für die Antwort-Aktion. */
export function replyButtonLabel(p: Platform | string): string | null {
  switch (p) {
    case "google":
      return "Auf Google antworten";
    case "jameda":
      return "Auf Jameda antworten";
    default:
      return null;
  }
}

/**
 * Best-effort deep link to the public profile. We don't store the exact
 * profile URL — instead we open a search on the platform with the Praxis
 * name. The user lands on their profile in one or two clicks.
 */
export function publicProfileUrl(
  platform: Platform,
  clinicName: string
): string | null {
  const q = encodeURIComponent(clinicName.trim());
  if (!q) return null;
  switch (platform) {
    case "google":
      return `https://www.google.com/maps/search/?api=1&query=${q}`;
    case "jameda":
      return `https://www.jameda.de/suche?q=${q}`;
    case "manual":
      return null;
    default:
      return null;
  }
}

/**
 * Stored review/profile URLs per platform, as configured under
 * /einstellungen. Used to deep-link the "Antworten"-Aktion directly to the
 * Praxis-Profil where a reply can be written.
 */
export interface ClinicReviewLinks {
  googleReviewUrl: string | null;
  jamedaReviewUrl: string | null;
  jamedaProfileUrl: string | null;
}

/**
 * Best link for replying to reviews on a platform. Prefers the explicitly
 * configured URL, then falls back to a name-based search so the button is
 * still useful before the Praxis has filled in its exact profile link.
 * Returns null only when there is nothing useful to open.
 */
export function replyLinkUrl(
  platform: Platform,
  clinicName: string,
  links: ClinicReviewLinks
): string | null {
  switch (platform) {
    case "google":
      return links.googleReviewUrl?.trim() || publicProfileUrl("google", clinicName);
    case "jameda":
      return (
        links.jamedaReviewUrl?.trim() ||
        links.jamedaProfileUrl?.trim() ||
        publicProfileUrl("jameda", clinicName)
      );
    default:
      return null;
  }
}
