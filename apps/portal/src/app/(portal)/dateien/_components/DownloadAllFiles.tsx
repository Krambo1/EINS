"use client";

import { useEffect, useState } from "react";
import { FolderDown } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { packZip, saveAs, splitParts, zipName, ZIP_PART_BYTES, type ZipFile } from "../../inhalte/_lib/zip";
import { listVonEinsFilesAction } from "../actions";
import { useFileList } from "./FileList";

// The words show where the card is wide enough ("Von EINS" is a container,
// `[@container(min-width:31rem)]`: from about 490 px, at 1100 and 1440 here).
// Narrower it is a square like the rows' own download, with a folder so it
// reads as "all". Tailwind needs every class written out in full.

/**
 * packZip, leaving out a file that does not load (gone from storage, a
 * dropped connection) instead of losing the whole ZIP: the part is packed
 * again without it. packZip reads the files in list order, so the n-th load
 * is the n-th file. `onBytes` hears negative counts when an attempt is
 * thrown away, so the progress steps back.
 */
async function packSkipping(
  files: ZipFile[],
  onBytes: (n: number) => void,
  onMissing: (f: ZipFile) => void
): Promise<Blob | null> {
  let rest = files;
  while (rest.length > 0) {
    let loading = -1;
    let read = 0;
    try {
      return await packZip(
        rest,
        (n) => {
          read += n;
          onBytes(n);
        },
        (url) => {
          loading++;
          return fetch(url);
        }
      );
    } catch (err) {
      const missing = rest[loading];
      if (!missing) throw err;
      onMissing(missing);
      onBytes(-read);
      rest = rest.filter((_, i) => i !== loading);
    }
  }
  return null;
}

/** „A“, „B“ und „C“, or „A“, „B“ und 4 weitere. */
function nameList(files: ZipFile[]): string {
  const quoted = files.map((f) => `„${f.name}“`);
  if (quoted.length <= 3) return quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(", ")} und ${quoted.at(-1)}`;
  return `${quoted.slice(0, 2).join(", ")} und ${quoted.length - 2} weitere`;
}

/**
 * "Alle herunterladen" in "Von EINS", as on Inhalte (Google Drive): every
 * file of the chosen Art, all pages, in one ZIP, or in parts of 1 GB. The
 * server action hands out fresh links; the browser reads the files straight
 * from storage and packs them. While it packs the percent counts up in the
 * same box, and leaving the page asks first. A file that does not load is
 * left out and named in the toast; the rest is still saved.
 */
export function DownloadAllFiles() {
  const list = useFileList();
  // Share of the bytes packed, 0 to 1; null while idle.
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress != null;
  const percent = `${Math.round((progress ?? 0) * 100)} %`;

  useEffect(() => {
    if (!busy) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [busy]);

  if (!list) throw new Error("DownloadAllFiles must sit inside FileListState");
  // Nothing under this Art: the button keeps its place, unseen.
  const hidden = list.visible.length === 0;

  const run = async () => {
    setProgress(0);
    try {
      const { base, files } = await listVonEinsFilesAction(list.kind ?? null);
      if (files.length === 0) {
        showActionFlash({ tone: "bad", title: "Keine Dateien", description: "Hier liegt noch nichts zum Herunterladen." });
        return;
      }

      // Progress by bytes where the sizes are known, else by files.
      let total = files.reduce((s, f) => s + (f.size ?? 0), 0);
      let bytes = 0;
      let count = 0;
      const show = () => setProgress(Math.min(total > 0 ? bytes / total : count / files.length, 0.99));
      const missing: ZipFile[] = [];

      const parts = splitParts(files, ZIP_PART_BYTES);
      let saved = 0;
      for (const [i, part] of parts.entries()) {
        const only = part[0]!;
        if (part.length === 1 && (only.size ?? 0) > ZIP_PART_BYTES) {
          // Too large for a part: the browser saves it as it is.
          saveAs(only.downloadUrl, only.name);
          bytes += only.size ?? 0;
          saved++;
        } else {
          const blob = await packSkipping(
            part,
            (n) => {
              bytes += n;
              show();
            },
            (f) => {
              missing.push(f);
              total -= f.size ?? 0;
            }
          );
          if (blob) {
            const href = URL.createObjectURL(blob);
            saveAs(href, zipName(base, i + 1, parts.length));
            // Revoked later: some browsers read the link after the click returns.
            setTimeout(() => URL.revokeObjectURL(href), 60_000);
            saved++;
          }
        }
        count += part.length;
        show();
      }

      const got = files.length - missing.length;
      const where =
        parts.length > 1
          ? `in ${saved} ${saved === 1 ? "Teil" : "Teilen"} im Ordner Downloads`
          : `in „${zipName(base, 1, 1)}“ im Ordner Downloads`;
      if (got === 0) {
        showActionFlash({
          tone: "bad",
          title: "Nicht heruntergeladen",
          description: `${files.length === 1 ? "Die Datei ließ" : "Die Dateien ließen"} sich nicht laden. Bitte versuchen Sie es noch einmal.`,
        });
      } else if (missing.length > 0) {
        // The rest is saved; say which ones are not in it.
        showActionFlash({
          tone: "bad",
          title: `ZIP-Datei gespeichert, ${missing.length === 1 ? "1 Datei fehlt" : `${missing.length} Dateien fehlen`}`,
          description: `${nameList(missing)} ${missing.length === 1 ? "ließ" : "ließen"} sich nicht laden. ${got === 1 ? "Die übrige liegt" : `Die übrigen ${got} liegen`} im Ordner Downloads.`,
        });
      } else {
        showActionFlash({
          tone: "good",
          title: parts.length > 1 ? "Dateien gespeichert" : "ZIP-Datei gespeichert",
          description:
            parts.length > 1
              ? `${files.length} Dateien ${where}. Fragt Ihr Browser, ob er mehrere Dateien laden darf, erlauben Sie es bitte.`
              : `${files.length} ${files.length === 1 ? "Datei" : "Dateien"} ${where}.`,
        });
      }
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht heruntergeladen",
        // The list of links did not come, or packing itself failed.
        description: "Bitte versuchen Sie es in einem Moment noch einmal.",
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
      aria-label="Alle herunterladen"
      title="Alle herunterladen (ZIP)"
      className={cn(
        RAISED_CONTROL,
        CONTROL,
        "w-[var(--control-h)] shrink-0 gap-2 px-0 tabular-nums text-fg-secondary hover:text-fg-primary disabled:opacity-100",
        "[@container(min-width:31rem)]:w-[11.5rem] [@container(min-width:31rem)]:px-3 [@container(min-width:31rem)]:text-fg-primary",
        hidden && !busy && "invisible"
      )}
    >
      <FolderDown
        className={cn("h-4 w-4 shrink-0", busy && "hidden [@container(min-width:31rem)]:block")}
        aria-hidden
      />
      <span className="hidden [@container(min-width:31rem)]:inline" aria-hidden>
        {busy ? `Wird gepackt: ${percent}` : "Alle herunterladen"}
      </span>
      {busy && (
        <span className="text-xs [@container(min-width:31rem)]:hidden" aria-hidden>
          {percent}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {busy ? `Wird gepackt: ${percent}` : ""}
      </span>
    </Button>
  );
}
