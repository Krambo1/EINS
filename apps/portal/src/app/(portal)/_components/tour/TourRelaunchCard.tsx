"use client";

import { Compass } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { useTour } from "./TourProvider";
import { CHAPTER_LIST } from "./chapterSteps";

/**
 * Einstellungen hub for the interactive portal tour: re-launch the full core
 * showcase on demand, plus start any single-area deep-dive chapter. All of it
 * is independent of the first-login lifecycle flags, so a manual start always
 * works whether or not the prompt was already completed or dismissed. Only the
 * core tour records completion; chapters are pure walkthroughs.
 */
export function TourRelaunchCard() {
  const { startCore, startChapter, isRunning } = useTour();
  return (
    <Card id="rundgang" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Portal-Rundgang</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-fg-secondary">
            Die geführte Tour zeigt Ihnen in wenigen Minuten, wo Ihre Anfragen,
            Ihre Auswertung und Ihre Bewertungen liegen und was EINS für Sie
            übernimmt. Sie können sie jederzeit erneut starten.
          </p>
          <Button onClick={startCore} disabled={isRunning} className="shrink-0">
            <Compass className="h-4 w-4" />
            Rundgang starten
          </Button>
        </div>

        <div>
          <h3 className="text-sm font-medium text-fg-primary">
            Einzelne Bereiche im Detail
          </h3>
          <p className="mt-1 text-sm text-fg-secondary">
            Kurze Rundgänge, die einen Bereich genauer erklären.
          </p>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {CHAPTER_LIST.map((chapter) => (
              <li
                key={chapter.key}
                className="flex flex-wrap items-center justify-between gap-3 bg-bg-secondary p-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-fg-primary">
                    {chapter.label}
                  </div>
                  <div className="text-sm text-fg-secondary">
                    {chapter.description}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startChapter(chapter.key)}
                  disabled={isRunning}
                  className="shrink-0"
                >
                  Starten
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
