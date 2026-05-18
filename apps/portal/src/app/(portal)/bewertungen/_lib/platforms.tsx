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
