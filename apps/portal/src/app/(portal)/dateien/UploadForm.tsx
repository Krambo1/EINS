"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, Label, Textarea, cn } from "@eins/ui";
import {
  AlertCircle,
  CheckCircle2,
  File as FileIcon,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  Send,
  X,
} from "lucide-react";
import {
  GENERAL_UPLOAD_ACCEPT,
  GENERAL_UPLOAD_EXTENSIONS,
  fileExtension,
  formatUploadLimit,
  isVideoExtension,
  uploadLimitForExtension,
} from "@/lib/uploads";
import { uploadErrorMessage, uploadFileToTarget } from "@/lib/upload-client";
import {
  createClientUploadTargetsAction,
  finalizeClientUploadsAction,
} from "./actions";
import { formatBytes } from "@/lib/formatting";

interface StagedFile {
  /** Local id for React keys — files can share names. */
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

/** How many files upload concurrently. */
const CONCURRENCY = 3;

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  // Synchronous double-click guard (state updates land a render later).
  const sendingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setFormError(null);
    setSuccessText(null);

    const next: StagedFile[] = [];
    for (const file of files) {
      const ext = fileExtension(file.name);
      if (!GENERAL_UPLOAD_EXTENSIONS.includes(ext)) {
        setFormError(
          `„${file.name}“ hat ein Format, das hier nicht unterstützt wird.`
        );
        continue;
      }
      if (file.size === 0) {
        setFormError(`„${file.name}“ ist leer.`);
        continue;
      }
      if (file.size > uploadLimitForExtension(ext)) {
        setFormError(
          `„${file.name}“ ist zu groß (max. ${formatUploadLimit(ext)}).`
        );
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        status: "staged",
        progress: 0,
      });
    }
    if (next.length > 0) setStaged((prev) => [...prev, ...next]);
  }

  function removeStaged(id: string) {
    setStaged((prev) => prev.filter((f) => f.id !== id));
  }

  function patch(id: string, changes: Partial<StagedFile>) {
    setStaged((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...changes } : f))
    );
  }

  async function send() {
    // Everything not yet registered with EINS: new rows, failed rows (retry)
    // and rows whose bytes landed but whose finalize failed.
    const open = staged.filter((s) => s.status !== "done");
    if (open.length === 0 || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFormError(null);
    setSuccessText(null);

    try {
      // 1. Mint one storage target per file that still needs its bytes sent.
      const toUpload = open.filter((s) => s.status !== "uploaded" || !s.key);
      const landed = new Map<string, { key: string; name: string; type?: string }>();
      for (const s of open) {
        if (s.status === "uploaded" && s.key) {
          landed.set(s.id, { key: s.key, name: s.file.name, type: s.file.type || undefined });
        }
      }

      if (toUpload.length > 0) {
        const res = await createClientUploadTargetsAction({
          files: toUpload.map((s) => ({
            name: s.file.name,
            size: s.file.size,
            type: s.file.type,
          })),
        });
        if (!res.ok) {
          setFormError(targetErrorText(res.error));
          return;
        }
        // Targets come back in request order; pair by index.
        const queue = toUpload.map((s, i) => ({
          staged: s,
          target: res.data.targets[i]!,
        }));

        // 2. Upload with limited concurrency + per-file progress.
        const workers = Array.from(
          { length: Math.min(CONCURRENCY, queue.length) },
          async () => {
            for (;;) {
              const job = queue.shift();
              if (!job) return;
              patch(job.staged.id, { status: "uploading", progress: 0, error: undefined });
              try {
                await uploadFileToTarget(job.target, job.staged.file, (p) =>
                  patch(job.staged.id, { progress: p })
                );
                patch(job.staged.id, {
                  status: "uploaded",
                  progress: 1,
                  key: job.target.key,
                });
                landed.set(job.staged.id, {
                  key: job.target.key,
                  name: job.staged.file.name,
                  type: job.staged.file.type || undefined,
                });
              } catch (err) {
                patch(job.staged.id, {
                  status: "error",
                  error: uploadErrorMessage(err),
                });
              }
            }
          }
        );
        await Promise.all(workers);
      }

      // 3. Register whatever landed.
      if (landed.size === 0) {
        setFormError(
          "Keine Datei konnte hochgeladen werden. Bitte prüfen Sie Ihre Internetverbindung und klicken Sie erneut auf Senden."
        );
        return;
      }
      let fin: Awaited<ReturnType<typeof finalizeClientUploadsAction>>;
      try {
        fin = await finalizeClientUploadsAction({
          files: [...landed.values()],
          note: note.trim() || undefined,
        });
      } catch {
        fin = { ok: false, error: "network" };
      }
      if (!fin.ok) {
        // Bytes are in storage; the rows stay "uploaded" so a retry only
        // registers them (no duplicate upload, no orphaned copies).
        setFormError(
          "Ihre Dateien sind hochgeladen, aber die Übermittlung an EINS hat nicht geklappt. Bitte klicken Sie erneut auf Senden."
        );
        return;
      }
      const failedKeys = new Set(fin.data.failedKeys);
      const landedIds = new Set(landed.keys());
      setStaged((prev) =>
        prev
          .map((f): StagedFile => {
            if (!landedIds.has(f.id)) return f;
            if (f.key && failedKeys.has(f.key)) {
              return {
                ...f,
                status: "error",
                key: undefined,
                progress: 0,
                error:
                  "Die Datei ist nicht vollständig angekommen oder zu groß. Bitte erneut senden.",
              };
            }
            return { ...f, status: "done" };
          })
          // Registered rows leave the list; failed ones stay for a retry.
          .filter((f) => f.status !== "done")
      );
      const failedCount = open.length - fin.data.saved;
      if (fin.data.saved > 0) setNote("");
      if (failedCount > 0) {
        setFormError(
          `${fin.data.saved} von ${open.length} Dateien bei EINS eingegangen. Die übrigen stehen noch in der Liste, bitte klicken Sie erneut auf Senden.`
        );
      } else {
        setSuccessText(
          fin.data.saved === 1
            ? "Ihre Datei ist bei EINS eingegangen."
            : `Alle ${fin.data.saved} Dateien sind bei EINS eingegangen.`
        );
      }
      router.refresh();
    } catch {
      setFormError(
        "Etwas ist schiefgelaufen, zum Beispiel wegen der Internetverbindung. Ihre Auswahl ist noch da, bitte klicken Sie erneut auf Senden."
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="opa-h3 text-fg-primary">Dateien hochladen</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Dokumente und Bilder bis 100 MB, Videos bis 2 GB pro Datei. Die
            Dateien gehen direkt an das EINS-Team.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={GENERAL_UPLOAD_ACCEPT}
          className="sr-only"
          onChange={onPick}
        />

        {staged.length > 0 && (
          <ul className="space-y-2">
            {staged.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-border bg-bg-primary px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <FileTypeIcon name={s.file.name} />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                    {s.file.name}
                  </span>
                  <span className="shrink-0 text-sm text-fg-secondary">
                    {formatBytes(s.file.size)}
                  </span>
                  {s.status === "staged" && !sending && (
                    <button
                      type="button"
                      onClick={() => removeStaged(s.id)}
                      className="-my-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-secondary hover:text-tone-bad"
                      aria-label={`${s.file.name} aus der Auswahl entfernen`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {s.status === "uploading" && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                  )}
                  {(s.status === "done" || s.status === "uploaded") && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-tone-good" />
                  )}
                  {s.status === "error" && !sending && (
                    <button
                      type="button"
                      onClick={() => removeStaged(s.id)}
                      className="-my-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-tone-bad hover:bg-bg-secondary"
                      aria-label={`${s.file.name} aus der Auswahl entfernen`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {(s.status === "uploading" ||
                  s.status === "uploaded" ||
                  s.status === "done") && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        s.status === "uploading" ? "bg-accent" : "bg-tone-good"
                      )}
                      style={{ width: `${Math.round(s.progress * 100)}%` }}
                    />
                  </div>
                )}
                {s.status === "error" && s.error && (
                  <p className="mt-1 flex items-start gap-1 text-sm text-tone-bad">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {s.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          disabled={sending}
          onClick={() => inputRef.current?.click()}
        >
          <Plus className="h-4 w-4" />
          {staged.length > 0 ? "Weitere Dateien auswählen" : "Dateien auswählen"}
        </Button>

        <div className="space-y-1.5">
          <Label htmlFor="upload-note" className="text-sm">
            Notiz an EINS (optional)
          </Label>
          <Textarea
            id="upload-note"
            rows={2}
            maxLength={2000}
            placeholder="Worum geht es bei diesen Dateien?"
            value={note}
            disabled={sending}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {formError && (
          <p className="flex items-start gap-1.5 text-sm text-tone-bad">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {formError}
          </p>
        )}
        {successText && (
          <p className="flex items-start gap-1.5 text-sm text-tone-good">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {successText}
          </p>
        )}

        <Button
          type="button"
          disabled={sending || staged.every((s) => s.status === "done")}
          onClick={send}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {sending
            ? "Wird hochgeladen …"
            : staged.some((s) => s.status === "error" || s.status === "uploaded")
              ? "Erneut senden"
              : staged.length > 1
                ? `${staged.length} Dateien an EINS senden`
                : "An EINS senden"}
        </Button>
      </CardContent>
    </Card>
  );
}

function FileTypeIcon({ name }: { name: string }) {
  const ext = fileExtension(name);
  if (isVideoExtension(ext)) {
    return <Film className="h-4 w-4 shrink-0 text-fg-tertiary" />;
  }
  if (["png", "jpg", "jpeg", "webp", "heic", "heif", "gif"].includes(ext)) {
    return <ImageIcon className="h-4 w-4 shrink-0 text-fg-tertiary" />;
  }
  return <FileIcon className="h-4 w-4 shrink-0 text-fg-tertiary" />;
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
