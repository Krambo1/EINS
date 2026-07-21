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
import { uploadFileToTarget } from "@/lib/upload-client";
import {
  createClientUploadTargetsAction,
  finalizeClientUploadsAction,
} from "./actions";

interface StagedFile {
  /** Local id for React keys — files can share names. */
  id: string;
  file: File;
  status: "staged" | "uploading" | "done" | "error";
  progress: number; // 0..1
  error?: string;
}

/** How many files upload concurrently. */
const CONCURRENCY = 3;

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
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
    if (staged.length === 0 || sending) return;
    setSending(true);
    setFormError(null);
    setSuccessText(null);

    try {
      // 1. Mint one storage target per file.
      const res = await createClientUploadTargetsAction({
        files: staged.map((s) => ({
          name: s.file.name,
          size: s.file.size,
          type: s.file.type,
        })),
      });
      if (!res.ok) {
        setFormError(targetErrorText(res.error));
        setSending(false);
        return;
      }
      // Targets come back in request order; pair by index.
      const jobs = staged.map((s, i) => ({
        staged: s,
        target: res.data.targets[i]!,
      }));

      // 2. Upload with limited concurrency + per-file progress.
      const queue = [...jobs];
      const uploaded: { key: string; name: string; type?: string }[] = [];
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queue.length) },
        async () => {
          for (;;) {
            const job = queue.shift();
            if (!job) return;
            patch(job.staged.id, { status: "uploading", progress: 0 });
            try {
              await uploadFileToTarget(job.target, job.staged.file, (p) =>
                patch(job.staged.id, { progress: p })
              );
              patch(job.staged.id, { status: "done", progress: 1 });
              uploaded.push({
                key: job.target.key,
                name: job.staged.file.name,
                type: job.staged.file.type || undefined,
              });
            } catch (err) {
              patch(job.staged.id, {
                status: "error",
                error: uploadErrorText(err),
              });
            }
          }
        }
      );
      await Promise.all(workers);

      // 3. Finalize whatever landed.
      if (uploaded.length > 0) {
        const fin = await finalizeClientUploadsAction({
          files: uploaded,
          note: note.trim() || undefined,
        });
        if (!fin.ok) {
          setFormError("Übermittlung fehlgeschlagen. Bitte erneut versuchen.");
          setSending(false);
          return;
        }
        const failedCount =
          staged.length - uploaded.length + fin.data.failed.length;
        setSuccessText(
          failedCount > 0
            ? `${fin.data.saved} von ${staged.length} Dateien bei EINS eingegangen. Bitte laden Sie die fehlgeschlagenen erneut hoch.`
            : fin.data.saved === 1
              ? "Ihre Datei ist bei EINS eingegangen."
              : `Alle ${fin.data.saved} Dateien sind bei EINS eingegangen.`
        );
        // Keep only failed rows staged so the user can retry them.
        setStaged((prev) => prev.filter((f) => f.status === "error"));
        setNote("");
        router.refresh();
      } else {
        setFormError(
          "Keine Datei konnte hochgeladen werden. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut."
        );
      }
    } catch {
      setFormError("Etwas ist schiefgelaufen. Bitte erneut versuchen.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Dateien hochladen</h2>
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
                  <span className="shrink-0 text-xs text-fg-tertiary">
                    {formatBytes(s.file.size)}
                  </span>
                  {s.status === "staged" && !sending && (
                    <button
                      type="button"
                      onClick={() => removeStaged(s.id)}
                      className="shrink-0 text-fg-tertiary hover:text-tone-bad"
                      aria-label={`${s.file.name} entfernen`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {s.status === "uploading" && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                  )}
                  {s.status === "done" && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-tone-good" />
                  )}
                  {s.status === "error" && (
                    <button
                      type="button"
                      onClick={() => removeStaged(s.id)}
                      className="shrink-0 text-tone-bad"
                      aria-label={`${s.file.name} entfernen`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {(s.status === "uploading" || s.status === "done") && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        s.status === "done" ? "bg-tone-good" : "bg-accent"
                      )}
                      style={{ width: `${Math.round(s.progress * 100)}%` }}
                    />
                  </div>
                )}
                {s.status === "error" && s.error && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-tone-bad">
                    <AlertCircle className="h-3.5 w-3.5" />
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
          disabled={sending || staged.filter((s) => s.status !== "error").length === 0}
          onClick={send}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {sending
            ? "Wird hochgeladen …"
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

function uploadErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "too_large") return "Datei zu groß.";
  if (msg === "network_error") {
    return "Verbindung unterbrochen. Bitte erneut versuchen.";
  }
  return "Hochladen fehlgeschlagen. Bitte erneut versuchen.";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
