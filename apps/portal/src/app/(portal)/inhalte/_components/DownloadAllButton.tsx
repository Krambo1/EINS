"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { packZip, safeName, saveAs, splitParts, zipName, ZIP_PART_BYTES, type ZipFile } from "../_lib/zip";

/**
 * "Alle herunterladen" (Google Drive, Frame.io): the file of every post in
 * one ZIP, or in parts of 1 GB when there is more (as Drive does).
 * While it packs, the label counts up in place; the button keeps its width,
 * so nothing next to it moves. On the phone a square with the icon (the
 * percent while packing), so the card title stays whole (Dateien does the
 * same). Leaving the page asks first, the packing
 * would be lost.
 */
export function DownloadAllButton({
  practiceName,
  hidden,
}: {
  practiceName: string;
  /** No post has a file yet: the button keeps its place, unseen. */
  hidden: boolean;
}) {
  // Share of the bytes packed, 0 to 1; null while idle.
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress != null;

  useEffect(() => {
    if (!busy) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [busy]);

  const run = async () => {
    setProgress(0);
    try {
      const res = await fetch("/api/inhalte/medien", { cache: "no-store" });
      if (!res.ok) throw new Error(`list ${res.status}`);
      const { files } = (await res.json()) as { files: ZipFile[] };
      if (files.length === 0) {
        showActionFlash({ tone: "bad", title: "Keine Dateien", description: "Hier liegt noch nichts zum Herunterladen." });
        return;
      }

      // Progress by bytes where the sizes are known, else by files.
      const total = files.reduce((s, f) => s + (f.size ?? 0), 0);
      let bytes = 0;
      let count = 0;
      const show = () =>
        setProgress(Math.min(total > 0 ? bytes / total : count / files.length, 0.99));

      const date = new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
      const base = safeName(`Beiträge ${practiceName} ${date}`, "Beiträge");
      const parts = splitParts(files, ZIP_PART_BYTES);
      for (const [i, part] of parts.entries()) {
        const only = part[0]!;
        if (part.length === 1 && (only.size ?? 0) > ZIP_PART_BYTES) {
          // Too large for a part: the browser saves it as it is.
          saveAs(only.downloadUrl, only.name);
          bytes += only.size ?? 0;
        } else {
          const blob = await packZip(part, (n) => {
            bytes += n;
            show();
          });
          const href = URL.createObjectURL(blob);
          saveAs(href, zipName(base, i + 1, parts.length));
          // Revoked later: some browsers read the link after the click returns.
          setTimeout(() => URL.revokeObjectURL(href), 60_000);
        }
        count += part.length;
        show();
      }

      showActionFlash({
        tone: "good",
        title: parts.length > 1 ? "Dateien gespeichert" : "ZIP-Datei gespeichert",
        description:
          parts.length > 1
            ? `${files.length} Dateien in ${parts.length} Teilen im Ordner Downloads. Fragt Ihr Browser, ob er mehrere Dateien laden darf, erlauben Sie es bitte.`
            : `${files.length} ${files.length === 1 ? "Datei" : "Dateien"} in „${zipName(base, 1, 1)}“ im Ordner Downloads.`,
      });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht heruntergeladen",
        description: "Eine Datei ließ sich nicht laden. Bitte versuchen Sie es noch einmal.",
      });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={run}
      disabled={busy}
      aria-busy={busy}
      aria-label={busy ? undefined : "Alle herunterladen"}
      className={cn(
        RAISED_CONTROL,
        CONTROL,
        "w-[var(--control-h)] gap-2 px-0 tabular-nums disabled:opacity-100 sm:w-[11.5rem] sm:px-3",
        hidden && !busy && "invisible"
      )}
    >
      <Download className={cn("h-4 w-4 shrink-0", busy && "hidden sm:block")} aria-hidden />
      <span aria-live="polite" className={cn(!busy && "hidden sm:inline")}>
        {busy ? (
          <>
            <span className="hidden sm:inline">Wird gepackt: </span>
            {Math.round((progress ?? 0) * 100)} %
          </>
        ) : (
          "Alle herunterladen"
        )}
      </span>
    </Button>
  );
}
