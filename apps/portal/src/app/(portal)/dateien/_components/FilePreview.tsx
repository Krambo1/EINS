"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
} from "@eins/ui";
import {
  CARD_TITLE,
  CONTROL,
  CONTROL_SQUARE,
  RAISED_CONTROL,
} from "../../dashboard/_components/dash-ui";

export type PreviewItem = {
  id: string;
  name: string;
  /** Opens the file. */
  url: string;
  /** Saves it under its name. */
  downloadUrl: string;
  kind: "image" | "video";
  /** The row's facts, under the name ("4,6 MB · 26.10.2026"). */
  meta: string;
};

/**
 * Quick look for the pictures and videos of a card, like Drive's and
 * Dropbox's preview: a click on the name shows the file over the page,
 * ←/→ go through the card's files, "Herunterladen" saves it. PDFs and other
 * files keep opening in a new tab (the browser's own viewer; the portal's
 * frame headers forbid showing them in a frame). A click with Strg/⌘ or the
 * middle button still opens a tab, the name stays a plain link.
 *
 * The rows stay server-rendered: one click handler on the card finds the
 * name by its data-preview-id.
 */
export function FilePreview({ items, children }: { items: PreviewItem[]; children: ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const item = index != null ? items[index] : undefined;

  const go = (next: number) => {
    if (next < 0 || next >= items.length) return;
    setBroken(false);
    setIndex(next);
  };

  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(index - 1);
      if (e.key === "ArrowRight") go(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="contents"
      onClickCapture={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-preview-id]");
        const at = a ? items.findIndex((it) => it.id === a.dataset.previewId) : -1;
        if (at < 0) return;
        e.preventDefault();
        go(at);
      }}
    >
      {children}
      <Dialog open={item != null} onOpenChange={(o) => !o && setIndex(null)}>
        {item && (
          <DialogContent
            // The built-in corner close is replaced by the raised one in the
            // header row, as in the send panel.
            className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden rounded-[var(--r-card)] border-0 bg-[var(--surface-tile)] p-0 elev-popover md:h-[calc(100dvh-4rem)] md:p-0 [&>button:last-child]:hidden"
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pt-5 md:px-6 md:pt-6">
              <div className="flex min-h-[var(--control-h)] min-w-0 flex-1 flex-col justify-center">
                <DialogTitle className={cn(CARD_TITLE, "break-words")}>{item.name}</DialogTitle>
                <DialogDescription className="text-sm leading-5 text-fg-secondary">{item.meta}</DialogDescription>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild variant="outline" className={cn(RAISED_CONTROL, CONTROL, "max-md:w-[var(--control-h)] max-md:px-0 md:px-4")}>
                  <a href={item.downloadUrl} download={item.name} aria-label={`Herunterladen: ${item.name}`}>
                    <Download className="h-4 w-4" aria-hidden />
                    <span className="hidden md:inline">Herunterladen</span>
                  </a>
                </Button>
                <Button asChild variant="outline" className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE)}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="In neuem Tab öffnen" title="In neuem Tab öffnen">
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                </Button>
                <DialogClose asChild>
                  <Button variant="outline" aria-label="Schließen" className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE)}>
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                </DialogClose>
              </div>
            </div>

            <div className="elev-inset mx-5 mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--r-panel)] bg-[var(--well)] md:mx-6">
              {broken ? (
                <p className="max-w-sm px-6 text-center text-[15px] leading-6 text-fg-secondary">
                  Diese Datei lässt sich hier nicht zeigen. Laden Sie sie herunter oder öffnen Sie sie in
                  einem neuen Tab.
                </p>
              ) : item.kind === "video" ? (
                <video
                  key={item.id}
                  src={item.url}
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => setBroken(true)}
                  className="h-full w-full"
                />
              ) : (
                // A presigned storage URL: next/image would proxy every view.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={item.id}
                  src={item.url}
                  alt={item.name}
                  onError={() => setBroken(true)}
                  className="h-full w-full object-contain"
                />
              )}
            </div>

            <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-6">
              <span className="text-sm tabular-nums text-fg-secondary">
                Datei {index! + 1} von {items.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => go(index! - 1)}
                  className={cn(RAISED_CONTROL, CONTROL)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Zurück
                </Button>
                <Button
                  variant="outline"
                  disabled={index === items.length - 1}
                  onClick={() => go(index! + 1)}
                  className={cn(RAISED_CONTROL, CONTROL)}
                >
                  Weiter
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
