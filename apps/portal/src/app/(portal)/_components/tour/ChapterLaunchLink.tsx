"use client";

import { Compass } from "lucide-react";
import { useTour } from "./TourProvider";
import type { ChapterKey } from "./chapterSteps";

/**
 * Subtle "Kurz erklärt" pill that launches an on-demand deep-dive chapter for
 * the current page. Sits in a page header. Render server-side only for the
 * Inhaber (the tour audience), matching the Einstellungen hub.
 */
export function ChapterLaunchLink({ chapter }: { chapter: ChapterKey }) {
  const { startChapter, isRunning } = useTour();
  return (
    <button
      type="button"
      onClick={() => startChapter(chapter)}
      disabled={isRunning}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary disabled:pointer-events-none disabled:opacity-50"
    >
      <Compass className="h-3.5 w-3.5" aria-hidden />
      Kurz erklärt
    </button>
  );
}
