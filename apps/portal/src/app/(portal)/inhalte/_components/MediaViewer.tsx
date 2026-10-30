"use client";

import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContentUnstyled,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@eins/ui";
import { CARD_TITLE, CONTROL, CONTROL_SQUARE, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import type { PostFile } from "../_lib/view";

/** A post that has a file, as the viewer pages through them. */
export type ViewerItem = { id: string; title: string; file: PostFile };

/**
 * A post's file, large, over the page (Frame.io's viewer, Linear's Peek):
 * the picture or the playing video, the post's title and the file's facts,
 * Zurück and Weiter through the files of every post, and the download. The arrow keys page
 * too, Esc closes. One size for every file: the viewer fills the screen on
 * the phone and stands at a fixed width from lg; the file is letterboxed in
 * it, never cropped, and the buttons stay where they are.
 */
export function MediaViewer({
  rows,
  index,
  onIndex,
}: {
  rows: ViewerItem[];
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const row = index == null ? null : (rows[index] ?? null);
  const at = index ?? 0;
  const go = (next: number) => {
    if (next >= 0 && next < rows.length) onIndex(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The video's own controls keep the arrow keys while they have focus.
    if (e.target instanceof HTMLVideoElement) return;
    if (e.key === "ArrowLeft") go(at - 1);
    if (e.key === "ArrowRight") go(at + 1);
  };

  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onIndex(null)}>
      <DialogPortal>
        <DialogOverlay />
        {row && (
          <DialogContentUnstyled
            aria-describedby={undefined}
            onKeyDown={onKeyDown}
            className="elev-card fixed inset-2 z-50 flex flex-col rounded-[var(--r-card)] bg-[var(--surface-tile)] p-4 focus:outline-none sm:inset-6 md:p-6 lg:inset-x-auto lg:left-1/2 lg:w-[64rem] lg:-translate-x-1/2"
          >
            <div className="flex shrink-0 items-start gap-3">
              <DialogTitle className={cn("min-w-0 flex-1 break-words pt-2.5", CARD_TITLE)}>{row.title}</DialogTitle>
              <span className="flex h-[var(--control-h)] shrink-0 items-center text-sm tabular-nums text-fg-secondary">
                {at + 1} von {rows.length}
              </span>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Schließen"
                  className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "shrink-0")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </DialogClose>
            </div>

            <div className="elev-inset mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--r-panel)] bg-[var(--well)]">
              {row.file.isVideo ? (
                <video
                  key={row.file.url}
                  src={row.file.url}
                  poster={row.file.thumbUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full max-h-full w-full object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={row.file.url} src={row.file.url} alt={row.title} className="h-full max-h-full w-full object-contain" />
              )}
            </div>

            <div className="mt-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-sm leading-5 tabular-nums text-fg-secondary">{row.file.facts}</p>
              {/* Three fixed slots: Zurück, Weiter, Herunterladen. */}
              <div className="grid shrink-0 grid-cols-[var(--control-h)_var(--control-h)_minmax(0,1fr)] gap-2 sm:grid-cols-[auto_auto_10.5rem]">
                <Button
                  type="button"
                  variant="outline"
                  disabled={at <= 0}
                  onClick={() => go(at - 1)}
                  aria-label="Vorherige Datei"
                  className={cn(RAISED_CONTROL, CONTROL, "px-0 sm:px-3")}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Zurück</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={at >= rows.length - 1}
                  onClick={() => go(at + 1)}
                  aria-label="Nächste Datei"
                  className={cn(RAISED_CONTROL, CONTROL, "px-0 sm:px-3")}
                >
                  <span className="hidden sm:inline">Weiter</span>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
                <Button asChild className={cn(CONTROL, "px-3")}>
                  <a href={row.file.downloadUrl} download>
                    <Download className="h-4 w-4" aria-hidden />
                    Herunterladen
                  </a>
                </Button>
              </div>
            </div>
          </DialogContentUnstyled>
        )}
      </DialogPortal>
    </Dialog>
  );
}
