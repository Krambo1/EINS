import { ExternalLink } from "lucide-react";

/**
 * Google's Place-ID-Finder beside the "Google Place-ID" label; also drawn by
 * `loading.tsx`, so the label wraps the same way in both.
 */
export function PlaceIdFinderLink() {
  return (
    <a
      href="https://developers.google.com/maps/documentation/places/web-service/place-id"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--r-small)] text-sm font-medium text-fg-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Place-ID-Finder
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

/** The Sternwerte fields: one under the other until lg, where the finder fits beside its label. */
export const STERNWERTE_GRID = "grid items-end gap-x-4 gap-y-5 lg:grid-cols-2";
