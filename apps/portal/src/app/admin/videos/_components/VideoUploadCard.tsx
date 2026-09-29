"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, Input, Label, Textarea, cn } from "@eins/ui";
import { AlertCircle, CheckCircle2, Film, Loader2, Upload, X } from "lucide-react";
import {
  MAX_VIDEO_BYTES,
  VIDEO_EXTENSIONS,
  extensionOf,
  formatDuration,
  isVideoExtension,
} from "@/lib/outreach-video";
import { uploadFileToTarget } from "@/lib/upload-client";
import { createOutreachVideoAction, createVideoUploadTargetAction } from "../actions";
import { CopyLinkButton } from "./CopyLinkButton";

const ACCEPT = VIDEO_EXTENSIONS.map((e) => `.${e}`).join(",");

interface Probe {
  durationSeconds: number | null;
  poster: Blob | null;
}

type Phase =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "uploading"; progress: number }
  | { step: "saving" }
  | { step: "done"; url: string };

export function VideoUploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [praxisName, setPraxisName] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [notionPage, setNotionPage] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = phase.step === "checking" || phase.step === "uploading" || phase.step === "saving";

  async function pick(f: File | undefined) {
    if (!f || busy) return;
    setError(null);
    setPhase({ step: "idle" });
    if (!isVideoExtension(extensionOf(f.name))) {
      setError("Bitte eine Videodatei wählen (MP4, MOV, WebM).");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Die Datei ist größer als 2 GB.");
      return;
    }
    setPhase({ step: "checking" });
    try {
      const p = await probeVideo(f);
      setFile(f);
      setProbe(p);
      setPhase({ step: "idle" });
    } catch {
      setFile(null);
      setProbe(null);
      setPhase({ step: "idle" });
      setError(
        "Dieses Video spielt im Browser nicht ab. Bitte als MP4 (H.264) exportieren und erneut wählen."
      );
    }
  }

  function reset() {
    setFile(null);
    setProbe(null);
    setTitle("");
    setMessage("");
    setRecipientEmail("");
    setNotionPage("");
    setPraxisName("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    if (!praxisName.trim()) {
      setError("Bitte den Namen der Praxis eintragen.");
      return;
    }
    setError(null);

    try {
      setPhase({ step: "uploading", progress: 0 });
      const target = await createVideoUploadTargetAction({
        kind: "video",
        filename: file.name,
        size: file.size,
        contentType: file.type || null,
      });
      if (!target.ok) throw new Error(target.error);
      await uploadFileToTarget(target.data, file, (p) =>
        setPhase({ step: "uploading", progress: p })
      );

      // Poster is a nice-to-have: a failure here must not lose the video.
      let posterKey: string | null = null;
      if (probe?.poster) {
        try {
          const posterFile = new File([probe.poster], "poster.jpg", { type: "image/jpeg" });
          const pt = await createVideoUploadTargetAction({
            kind: "poster",
            filename: posterFile.name,
            size: posterFile.size,
            contentType: "image/jpeg",
          });
          if (pt.ok) {
            await uploadFileToTarget(pt.data, posterFile);
            posterKey = pt.data.key;
          }
        } catch {
          posterKey = null;
        }
      }

      setPhase({ step: "saving" });
      const created = await createOutreachVideoAction({
        videoKey: target.data.key,
        posterKey,
        praxisName,
        title,
        message,
        recipientEmail,
        notionPage,
        durationSeconds: probe?.durationSeconds ?? null,
      });
      if (!created.ok) throw new Error(created.error);

      setPhase({ step: "done", url: created.data.url });
      reset();
      router.refresh();
    } catch (err) {
      setPhase({ step: "idle" });
      setError(errorText(err instanceof Error ? err.message : ""));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Video hochladen</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            MP4 bis 2 GB. Danach bekommen Sie einen Link auf eins.ag, den Sie der Praxis schicken.
          </p>
        </div>

        {phase.step === "done" && (
          <div className="rounded-xl border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-tone-good">
              <CheckCircle2 className="h-4 w-4" />
              Video ist online
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-bg-primary px-3 py-2 text-sm">
                {phase.url}
              </code>
              <CopyLinkButton url={phase.url} />
              <a
                href={`${phase.url}?intern=1`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-accent underline-offset-4 hover:underline"
              >
                Ansehen
              </a>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {file ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-primary px-3 py-2">
              <Film className="h-4 w-4 shrink-0 text-fg-tertiary" />
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <span className="shrink-0 text-xs text-fg-tertiary">
                {formatBytes(file.size)}
                {probe?.durationSeconds ? ` · ${formatDuration(probe.durationSeconds)}` : ""}
              </span>
              {!busy && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setProbe(null);
                  }}
                  className="shrink-0 text-fg-tertiary hover:text-tone-bad"
                  aria-label="Datei entfernen"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void pick(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors",
                dragging ? "border-accent bg-bg-secondary" : "border-border hover:border-border-hover"
              )}
            >
              {phase.step === "checking" ? (
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              ) : (
                <Upload className="h-6 w-6 text-fg-tertiary" />
              )}
              <span className="text-base text-fg-primary">
                {phase.step === "checking" ? "Video wird geprüft …" : "Video hierher ziehen oder auswählen"}
              </span>
            </button>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Praxis" htmlFor="v-praxis">
              <Input
                id="v-praxis"
                required
                maxLength={200}
                placeholder="Praxis Dr. Muster"
                value={praxisName}
                disabled={busy}
                onChange={(e) => setPraxisName(e.target.value)}
              />
            </Field>
            <Field label="Überschrift (optional)" htmlFor="v-title">
              <Input
                id="v-title"
                maxLength={200}
                placeholder="Ihre Website im Check"
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="E-Mail der Praxis (optional)" htmlFor="v-email">
              <Input
                id="v-email"
                type="email"
                maxLength={320}
                value={recipientEmail}
                disabled={busy}
                onChange={(e) => setRecipientEmail(e.target.value)}
              />
            </Field>
            <Field label="Notion-Link zum Lead (optional)" htmlFor="v-notion">
              <Input
                id="v-notion"
                maxLength={500}
                placeholder="https://www.notion.so/…"
                value={notionPage}
                disabled={busy}
                onChange={(e) => setNotionPage(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Persönliche Notiz über dem Video (optional)" htmlFor="v-message">
            <Textarea
              id="v-message"
              rows={3}
              maxLength={1000}
              value={message}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>

          {phase.step === "uploading" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-secondary">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(phase.progress * 100)}%` }}
              />
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-tone-bad">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" disabled={!file || busy}>
            {busy && phase.step !== "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {phase.step === "uploading"
              ? `Wird hochgeladen … ${Math.round(phase.progress * 100)} %`
              : phase.step === "saving"
                ? "Link wird erstellt …"
                : "Hochladen und Link erstellen"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Load the file into a detached <video>, so a codec this browser cannot play
 * (HEVC, ProRes) is caught before upload instead of by the Praxis. Also reads
 * the duration and grabs a poster frame at ~10 % (max 1 s in).
 */
async function probeVideo(file: File): Promise<Probe> {
  const src = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = src;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 20_000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("unplayable"));
      };
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error("unplayable");

    const durationSeconds = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
    const seekTo = Math.min(1, (durationSeconds ?? 2) / 10);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 4000);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      video.currentTime = seekTo;
    });

    let poster: Blob | null = null;
    try {
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    } catch {
      poster = null;
    }
    return { durationSeconds, poster };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(src);
  }
}

function errorText(code: string): string {
  if (code === "bad_type") return "Dieses Dateiformat wird nicht unterstützt.";
  if (code === "too_large") return "Die Datei ist größer als 2 GB.";
  if (code === "network_error") return "Verbindung unterbrochen. Bitte erneut versuchen.";
  if (code === "not_uploaded") return "Das Video ist nicht vollständig angekommen. Bitte erneut versuchen.";
  if (code === "invalid") return "Bitte die Eingaben prüfen (z. B. die E-Mail-Adresse).";
  return "Hochladen fehlgeschlagen. Bitte erneut versuchen.";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
