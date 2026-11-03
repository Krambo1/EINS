"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Upload, X } from "lucide-react";
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
  GENERAL_UPLOAD_ACCEPT,
  GENERAL_UPLOAD_EXTENSIONS,
  fileExtension,
  formatUploadLimit,
  uploadLimitForExtension,
} from "@/lib/uploads";
import { uploadErrorMessage, uploadFileToTarget } from "@/lib/upload-client";
import {
  CARD_TITLE,
  CONTROL,
  CONTROL_SQUARE,
  RAISED_CONTROL,
} from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { createClientUploadTargetsAction, finalizeClientUploadsAction } from "../actions";
import { FileTypeIcon, formatFileSize } from "./file-ui";
import { useFileList } from "./FileList";
import { ScrollHint } from "@/app/_components/ScrollHint";

interface StagedFile {
  /** Local id for React keys: files can share names. */
  id: string;
  file: File;
  /**
   * staged: waiting; uploading: bytes in flight; uploaded: bytes are in
   * storage but EINS has not registered them yet (finalize pending or failed,
   * a retry only re-finalizes, never re-uploads); done: registered;
   * error: needs a new upload.
   */
  status: "staged" | "uploading" | "uploaded" | "done" | "error";
  progress: number; // 0..1
  error?: string;
  /** Storage key once the bytes landed. */
  key?: string;
}

type UploadTarget = Extract<
  Awaited<ReturnType<typeof createClientUploadTargetsAction>>,
  { ok: true }
>["data"]["targets"][number];

/** How many files upload concurrently. */
const CONCURRENCY = 3;
/** Files per server call (MAX_FILES_PER_BATCH in actions.ts). */
const BATCH = 20;
/** Images the browser can draw as a thumbnail (no HEIC). */
const THUMB_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

type SendApi = {
  openPanel: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
};
const SendContext = createContext<SendApi | null>(null);

/**
 * Sending files to EINS, around the card "An EINS gesendet": its button
 * "Dateien senden" (SendFilesButton, in the card's header) and the panel it
 * opens, copied from Linear's new-issue dialog. Sits inside the card's
 * FileListState, so a send can go back to its first page. Files get in four
 * ways, as on Convertio, Smash, Drive and Slack:
 * - "Dateien senden" or the empty well opens the file picker;
 * - files dragged anywhere onto the page: the card shows where they go and
 *   the drop opens the panel with them (the browser never opens the file in
 *   the tab instead);
 * - a dragged folder brings every file inside it;
 * - a copied image or file pasted with Strg+V.
 *
 * The panel has one height: the well takes the room left and scrolls, so
 * more files never move "Senden". Bytes go straight to storage (see
 * server/uploads.ts), then the batch is registered with EINS. Confirmations
 * and errors come as a toast; when everything arrived the panel closes and
 * the files stand at the top of "An EINS gesendet", lit up once.
 */
export function SendArea({ children }: { children: ReactNode }) {
  const router = useRouter();
  // The pages of "An EINS gesendet" (SendArea sits inside its FileListState).
  const list = useFileList();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  /** Ids sent by the running "Senden", for the overall percentage. */
  const [batch, setBatch] = useState<string[] | null>(null);
  /** A file drag is over the window / over this card. */
  const [dragging, setDragging] = useState(false);
  const [overCard, setOverCard] = useState(false);
  // Synchronous guards (state updates land a render later).
  const sendingRef = useRef(false);
  const controllers = useRef(new Map<string, AbortController>());
  const removed = useRef(new Set<string>());
  // Where an X stood: focus goes to the X now in that place (or the one
  // above), or to "Dateien auswählen" once the list is empty.
  const focusAfterRemove = useRef<number | null>(null);
  const stagedListRef = useRef<HTMLUListElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);

  const addFiles = useCallback((files: File[]) => {
    const ok: StagedFile[] = [];
    const problems: string[] = [];
    for (const raw of files) {
      const file = namePasted(raw);
      if (isSystemFile(file.name)) continue;
      const ext = fileExtension(file.name);
      if (!GENERAL_UPLOAD_EXTENSIONS.includes(ext)) {
        problems.push(`„${file.name}“ hat ein Format, das hier nicht unterstützt wird.`);
      } else if (file.size === 0) {
        problems.push(`„${file.name}“ ist leer.`);
      } else if (file.size > uploadLimitForExtension(ext)) {
        problems.push(`„${file.name}“ ist zu groß (max. ${formatUploadLimit(ext)}).`);
      } else {
        ok.push({ id: crypto.randomUUID(), file, status: "staged", progress: 0 });
      }
    }
    // One toast for the whole drop, not one per file.
    if (problems.length > 0) {
      showActionFlash({
        tone: "bad",
        title:
          problems.length === 1
            ? "Datei nicht hinzugefügt"
            : `${problems.length} Dateien nicht hinzugefügt`,
        description:
          problems.slice(0, 3).join(" ") +
          (problems.length > 3 ? ` Dazu ${problems.length - 3} weitere.` : ""),
      });
    }
    if (ok.length === 0) return;
    // The same file twice (same name, size and date) is only taken once.
    setStaged((prev) => {
      const seen = new Set(prev.filter((s) => s.status !== "done").map((s) => fingerprint(s.file)));
      const fresh = ok.filter((s) => {
        const k = fingerprint(s.file);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return [...prev, ...fresh];
    });
  }, []);

  /** Files from a drop or a paste: into the panel, which opens. */
  const receive = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (sendingRef.current) {
        showActionFlash({
          tone: "bad",
          title: "Noch nicht hinzugefügt",
          description: "Bitte warten Sie, bis die Dateien gesendet sind, und legen Sie die neuen dann noch einmal ab.",
        });
        return;
      }
      addFiles(files);
      setOpen(true);
    },
    [addFiles]
  );

  // Drag and drop onto the whole page. dragover repeats every ~50 ms while a
  // drag is over the window; when it stops, the drag has left or ended.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const end = () => {
      clearTimeout(timer);
      setDragging(false);
      setOverCard(false);
    };
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      // Allow the drop; without this the browser opens the file in the tab.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragging(true);
      setOverCard(cardRef.current?.contains(e.target as Node) ?? false);
      clearTimeout(timer);
      timer = setTimeout(end, 250);
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget == null) end();
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e) || !e.dataTransfer) return;
      e.preventDefault();
      end();
      void filesFromDrop(e.dataTransfer).then(receive);
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [receive]);

  // A copied screenshot or file, pasted anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      receive(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [receive]);

  // Closing or reloading the tab mid-upload would lose the files: the
  // browser asks first, as on WeTransfer and Drive.
  useEffect(() => {
    if (!sending) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [sending]);

  useEffect(() => {
    const at = focusAfterRemove.current;
    if (at == null) return;
    focusAfterRemove.current = null;
    const xs = Array.from(stagedListRef.current?.querySelectorAll<HTMLButtonElement>("li > button") ?? []);
    (xs[Math.min(at, xs.length - 1)] ?? pickRef.current)?.focus();
  }, [staged]);

  function fail(title: string, description?: string) {
    showActionFlash({ tone: "bad", title, description });
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    addFiles(files);
  }

  /** Out of the list; a running upload is cancelled, a waiting one skipped. */
  function removeStaged(id: string) {
    focusAfterRemove.current = staged.findIndex((f) => f.id === id);
    if (sendingRef.current) removed.current.add(id);
    controllers.current.get(id)?.abort();
    setStaged((prev) => prev.filter((f) => f.id !== id));
  }

  function patch(id: string, changes: Partial<StagedFile>) {
    setStaged((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  }

  async function send() {
    // Everything not yet registered with EINS: new rows, failed rows (retry)
    // and rows whose bytes landed but whose finalize failed.
    const pending = staged.filter((s) => s.status !== "done");
    if (pending.length === 0 || sendingRef.current) return;
    sendingRef.current = true;
    removed.current.clear();
    setSending(true);
    setBatch(pending.map((s) => s.id));

    try {
      // 1. Mint one storage target per file that still needs its bytes sent,
      //    20 files per call.
      const toUpload = pending.filter((s) => s.status !== "uploaded" || !s.key);
      const landed = new Map<string, { key: string; name: string; type?: string }>();
      for (const s of pending) {
        if (s.status === "uploaded" && s.key) {
          landed.set(s.id, { key: s.key, name: s.file.name, type: s.file.type || undefined });
        }
      }

      if (toUpload.length > 0) {
        const queue: { staged: StagedFile; target: UploadTarget }[] = [];
        for (const part of chunk(toUpload, BATCH)) {
          const res = await createClientUploadTargetsAction({
            files: part.map((s) => ({ name: s.file.name, size: s.file.size, type: s.file.type })),
          });
          if (!res.ok) {
            fail("Nicht gesendet", targetErrorText(res.error));
            return;
          }
          // Targets come back in request order; pair by index.
          part.forEach((s, i) => queue.push({ staged: s, target: res.data.targets[i]! }));
        }

        // 2. Upload with limited concurrency + per-file progress.
        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
          for (;;) {
            const job = queue.shift();
            if (!job) return;
            const id = job.staged.id;
            if (removed.current.has(id)) continue;
            const ctrl = new AbortController();
            controllers.current.set(id, ctrl);
            patch(id, { status: "uploading", progress: 0, error: undefined });
            try {
              await uploadFileToTarget(job.target, job.staged.file, (p) => patch(id, { progress: p }), ctrl.signal);
              patch(id, { status: "uploaded", progress: 1, key: job.target.key });
              landed.set(id, {
                key: job.target.key,
                name: job.staged.file.name,
                type: job.staged.file.type || undefined,
              });
            } catch (err) {
              if (!removed.current.has(id)) patch(id, { status: "error", error: uploadErrorMessage(err) });
            } finally {
              controllers.current.delete(id);
            }
          }
        });
        await Promise.all(workers);
      }

      // Files taken out while sending are not counted.
      const asked = pending.filter((s) => !removed.current.has(s.id)).length;
      if (asked === 0) return;

      // 3. Register whatever landed, 20 files per call.
      if (landed.size === 0) {
        fail(
          "Nicht gesendet",
          "Keine Datei konnte hochgeladen werden. Bitte prüfen Sie Ihre Internetverbindung und klicken Sie erneut auf Senden."
        );
        return;
      }
      const registered = new Set<string>();
      const failedKeys = new Set<string>();
      let saved = 0;
      let unregistered = 0;
      for (const part of chunk([...landed.entries()], BATCH)) {
        let fin: Awaited<ReturnType<typeof finalizeClientUploadsAction>>;
        try {
          fin = await finalizeClientUploadsAction({
            files: part.map(([, f]) => f),
            note: note.trim() || undefined,
          });
        } catch {
          fin = { ok: false, error: "network" };
        }
        if (!fin.ok) {
          // Bytes are in storage; the rows stay "uploaded" so a retry only
          // registers them (no duplicate upload, no orphaned copies).
          unregistered += part.length;
          continue;
        }
        saved += fin.data.saved;
        fin.data.failedKeys.forEach((k) => failedKeys.add(k));
        part.forEach(([id]) => registered.add(id));
      }
      if (saved === 0 && unregistered > 0) {
        fail(
          "Noch nicht bei EINS",
          "Ihre Dateien sind hochgeladen, aber die Übermittlung an EINS hat nicht geklappt. Bitte klicken Sie erneut auf Senden."
        );
        return;
      }
      setStaged((prev) =>
        prev
          .map((f): StagedFile => {
            if (!registered.has(f.id)) return f;
            if (f.key && failedKeys.has(f.key)) {
              return {
                ...f,
                status: "error",
                key: undefined,
                progress: 0,
                error: "Die Datei ist nicht vollständig angekommen oder zu groß. Bitte erneut senden.",
              };
            }
            return { ...f, status: "done" };
          })
          // Registered rows leave the panel; failed ones stay for a retry.
          .filter((f) => f.status !== "done")
      );
      if (saved > 0) setNote("");
      if (saved < asked) {
        fail(
          "Nicht alle Dateien angekommen",
          `${saved} von ${asked} Dateien bei EINS eingegangen. Die übrigen stehen noch in der Liste, bitte klicken Sie erneut auf Senden.`
        );
        router.refresh();
      } else {
        showActionFlash({
          tone: "good",
          title:
            saved === 1
              ? "Ihre Datei ist bei EINS eingegangen."
              : `Alle ${saved} Dateien sind bei EINS eingegangen.`,
        });
        setOpen(false);
        // The new files stand on the first page of the card.
        list?.setPage(1);
        router.refresh();
      }
    } catch {
      fail(
        "Nicht gesendet",
        "Etwas ist schiefgelaufen, zum Beispiel wegen der Internetverbindung. Ihre Auswahl ist noch da, bitte klicken Sie erneut auf Senden."
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
      setBatch(null);
    }
  }

  const nothingToSend = staged.every((s) => s.status === "done");
  const totalBytes = staged.reduce((sum, s) => sum + s.file.size, 0);
  const percent = useMemo(() => {
    if (!batch) return 0;
    let total = 0;
    let done = 0;
    for (const s of staged) {
      if (!batch.includes(s.id)) continue;
      total += s.file.size;
      done += s.file.size * (s.status === "uploading" ? s.progress : s.status === "uploaded" ? 1 : 0);
    }
    return total > 0 ? Math.floor((done / total) * 100) : 0;
  }, [batch, staged]);

  const api = useMemo<SendApi>(() => ({ openPanel: () => setOpen(true), buttonRef }), []);

  return (
    <SendContext.Provider value={api}>
      {/* The grid item: min-w-0 so a long file name wraps instead of
          widening the column (the card inside has its own min-w-0). */}
      <div ref={cardRef} className="relative min-w-0">
        {children}
        {dragging && !open && (
          // Where the files go, over the whole card; the card keeps its size.
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[var(--r-card)] bg-[color-mix(in_srgb,var(--surface-tile)_94%,transparent)] px-6 text-center ring-2 ring-inset transition-shadow",
              overCard ? "ring-accent" : "ring-[var(--accent-glow)]"
            )}
          >
            <span className="elev-raised flex h-12 w-12 items-center justify-center rounded-[var(--r-panel)] bg-[var(--surface-raised)] text-accent">
              <Upload className="h-5 w-5" />
            </span>
            <p className="text-[17px] font-semibold leading-6 text-fg-primary">Zum Senden loslassen</p>
            <p className="max-w-xs text-sm leading-5 text-fg-secondary">
              Die Dateien gehen an EINS. Vor dem Senden sehen Sie sie noch einmal.
            </p>
          </div>
        )}
      </div>

      <Dialog
        open={open}
        // While files are on their way the panel stays open.
        onOpenChange={(o) => !sendingRef.current && setOpen(o)}
      >
        <DialogContent
          aria-describedby="send-panel-limits"
          // Back to "Dateien senden" when the panel closes (it has no
          // DialogTrigger: a drop or a paste opens it too).
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            buttonRef.current?.focus();
          }}
          // The built-in corner close is replaced by the raised one in the
          // header row, as in Linear's dialog.
          className="flex h-[min(36rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[36rem] flex-col overflow-hidden rounded-[var(--r-card)] border-0 bg-[var(--surface-tile)] p-0 elev-popover md:p-0 [&>button:last-child]:hidden"
        >
          <div className="flex h-[calc(var(--control-h)+1.25rem)] shrink-0 items-end justify-between gap-3 px-5 md:h-[calc(var(--control-h)+1.5rem)] md:px-6">
            <DialogTitle className={CARD_TITLE}>Dateien an EINS senden</DialogTitle>
            <DialogClose asChild>
              <Button
                variant="outline"
                disabled={sending}
                aria-label="Schließen"
                className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </DialogClose>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 md:px-6">
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={GENERAL_UPLOAD_ACCEPT}
              className="sr-only"
              onChange={onPick}
              tabIndex={-1}
            />
            {/* The chosen files, pressed into the panel. A drag over the
                page only rings it, the size stays. */}
            <div
              className={cn(
                "elev-inset flex min-h-0 flex-1 flex-col rounded-[var(--r-panel)] bg-[var(--well)] transition-shadow",
                dragging && "ring-2 ring-accent"
              )}
            >
              {staged.length === 0 ? (
                <button
                  ref={pickRef}
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[var(--r-panel)] px-6 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="elev-raised flex h-12 w-12 items-center justify-center rounded-[var(--r-panel)] bg-[var(--surface-raised)] text-fg-secondary">
                    <Upload className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[15px] font-medium leading-5 text-fg-primary">Dateien auswählen</span>
                  <span className="max-w-xs text-sm leading-5 text-fg-secondary">
                    Oder ziehen Sie Dateien und ganze Ordner hierher. Ein kopiertes Bild fügen Sie mit{" "}
                    {pasteKeys()} ein.
                  </span>
                </button>
              ) : (
                <>
                  {/* In a dialog, so its own arrow: the page-wide one sits under dialogs. */}
                  <ScrollHint className="flex min-h-0 flex-1 flex-col">
                    <ul ref={stagedListRef} className="scroll-shadows min-h-0 flex-1 px-1 py-1 [--scroll-bg:var(--well)]">
                      {staged.map((s) => {
                        const running = s.status === "uploading";
                        return (
                          <li key={s.id} className="flex min-h-16 items-center gap-3 px-2 py-2">
                            <StagedThumb file={s.file} />
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-[15px] font-medium leading-5 text-fg-primary">{s.file.name}</p>
                              <StagedMeta file={s} />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              // Bytes that landed are being registered; that
                              // last step cannot be taken back.
                              disabled={sending && s.status === "uploaded"}
                              onClick={() => removeStaged(s.id)}
                              aria-label={
                                running
                                  ? `Hochladen von ${s.file.name} abbrechen`
                                  : `${s.file.name} aus der Auswahl entfernen`
                              }
                              title={running ? "Abbrechen" : "Entfernen"}
                              className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "shrink-0 text-fg-secondary")}
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollHint>
                  <p className="flex h-9 shrink-0 items-center border-t border-border px-3 text-sm tabular-nums text-fg-secondary">
                    {staged.length === 1 ? "1 Datei" : `${staged.length} Dateien`}, zusammen{" "}
                    {formatFileSize(totalBytes)}
                  </p>
                </>
              )}
            </div>
            <DialogDescription id="send-panel-limits" className="mt-2 text-sm leading-5 text-fg-secondary">
              Dokumente und Bilder bis 100 MB, Videos bis 2 GB pro Datei.
            </DialogDescription>

            <label htmlFor="upload-note" className="mt-4 block text-[15px] font-medium leading-5 text-fg-primary">
              Notiz an EINS (optional)
            </label>
            <ScrollHint className="mt-2 shrink-0" watch={note}>
              <textarea
                id="upload-note"
                rows={3}
                maxLength={2000}
                placeholder="Worum geht es bei diesen Dateien?"
                value={note}
                disabled={sending}
                onChange={(e) => setNote(e.target.value)}
                className="elev-inset h-[5.5rem] w-full resize-none rounded-[var(--r-panel)] border-0 bg-[var(--surface-inset)] px-3 py-2 text-[15px] leading-6 text-fg-primary [scrollbar-width:none] placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 [&::-webkit-scrollbar]:hidden"
              />
            </ScrollHint>
          </div>

          <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-6">
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => inputRef.current?.click()}
              className={cn(RAISED_CONTROL, CONTROL, "px-4")}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Dateien hinzufügen
            </Button>
            <Button
              type="button"
              disabled={sending || nothingToSend}
              aria-busy={sending || undefined}
              onClick={send}
              className={cn(CONTROL, "w-32 shrink-0 px-4")}
            >
              <Send className="h-4 w-4" aria-hidden />
              {sending ? (
                // How far the whole batch is, as on WeTransfer; same width,
                // no spinner (DESIGN.md section 10).
                <span className="tabular-nums" aria-label={`${percent} Prozent gesendet`}>
                  {percent} %
                </span>
              ) : (
                "Senden"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SendContext.Provider>
  );
}

/**
 * "Dateien senden" in the header of "An EINS gesendet" (inside SendArea):
 * the size and place of the card controls. "Senden" alone on a phone, where
 * the card title needs the room.
 */
export function SendFilesButton() {
  const api = useContext(SendContext);
  if (!api) throw new Error("SendFilesButton must sit inside SendArea");
  return (
    <Button
      ref={api.buttonRef}
      onClick={api.openPanel}
      aria-label="Dateien senden"
      className={cn(CONTROL, "w-28 shrink-0 px-4 md:w-40")}
    >
      <Upload className="h-4 w-4" aria-hidden />
      <span className="md:hidden">Senden</span>
      <span className="hidden md:inline">Dateien senden</span>
    </Button>
  );
}

/** A thumbnail for a picture the browser can draw, else the type glyph. */
function StagedThumb({ file }: { file: File }) {
  const canDraw = THUMB_EXTENSIONS.includes(fileExtension(file.name));
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!canDraw) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, canDraw]);
  return (
    <span
      aria-hidden
      className="elev-raised flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--r-control)] bg-[var(--surface-raised)] text-fg-tertiary"
    >
      {url && !broken ? (
        // A local blob: next/image cannot load it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <FileTypeIcon name={file.name} />
      )}
    </span>
  );
}

/** Size, then the upload's progress or why it failed, in the file's line. */
function StagedMeta({ file: s }: { file: StagedFile }) {
  return (
    <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 text-sm leading-5 text-fg-secondary">
      <span className="tabular-nums">{formatFileSize(s.file.size)}</span>
      {(s.status === "uploading" || s.status === "uploaded") && (
        <span
          role="progressbar"
          aria-label={`${s.file.name} wird hochgeladen`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(s.progress * 100)}
          className="elev-inset h-1.5 w-24 overflow-hidden rounded-[var(--r-small)] bg-[var(--surface-inset)]"
        >
          <span
            className={cn(
              "block h-full rounded-[var(--r-small)] transition-[width]",
              s.status === "uploading" ? "bg-accent" : "bg-tone-good"
            )}
            style={{ width: `${Math.round(s.progress * 100)}%` }}
          />
        </span>
      )}
      {s.status === "error" && (
        // The dot stays at the first line when the message wraps.
        <span className="inline-flex items-start gap-1.5 font-medium text-fg-primary">
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-tone-bad" />
          {s.error ?? "Nicht angekommen"}
        </span>
      )}
    </div>
  );
}

/**
 * Every file of a drop, the ones inside dragged folders included (Smash,
 * Drive). The entries must be read while the drop event runs, so this is
 * called synchronously from the handler.
 */
function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const files = Array.from(dt.files);
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.() ?? null);
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve(files);
  const out: File[] = [];
  return Promise.all(
    entries.map((entry, i) => (entry ? walk(entry, out) : files[i] ? out.push(files[i]!) : 0))
  ).then(() => out);
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries hands out at most 100 entries per call.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) return;
    for (const e of batch) await walk(e, out);
  }
}

/** Folder clutter of macOS and Windows, never sent. */
function isSystemFile(name: string): boolean {
  return name.startsWith(".") || /^(thumbs\.db|desktop\.ini)$/i.test(name);
}

/** A pasted screenshot arrives as "image.png"; give it a telling name. */
function namePasted(file: File): File {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
  const d = new Date(file.lastModified || Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  return new File([file], `Eingefügtes Bild ${stamp}.${fileExtension(file.name)}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

function fingerprint(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

function pasteKeys(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ V" : "Strg + V";
}

function chunk<T>(all: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

function targetErrorText(code: string): string {
  if (code.startsWith("bad_type:")) {
    return `„${code.slice("bad_type:".length)}“ hat ein Format, das hier nicht unterstützt wird.`;
  }
  if (code.startsWith("too_large:")) {
    return `„${code.slice("too_large:".length)}“ ist zu groß.`;
  }
  return "Vorbereitung fehlgeschlagen. Bitte erneut versuchen.";
}
