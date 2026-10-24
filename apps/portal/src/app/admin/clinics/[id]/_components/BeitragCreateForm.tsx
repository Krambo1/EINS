"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea } from "@eins/ui";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { CONTENT_FORMATS, CONTENT_FORMAT_LABELS } from "@/lib/content-status";
import {
  UPLOAD_IMAGE_EXTENSIONS,
  UPLOAD_VIDEO_EXTENSIONS,
  fileExtension,
  formatUploadLimit,
  uploadLimitForExtension,
} from "@/lib/uploads";
import { uploadErrorMessage, uploadFileToTarget } from "@/lib/upload-client";
import { createBeitragAction, createBeitragUploadTargetAction } from "../beitrag-actions";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const ASSET_EXTENSIONS: readonly string[] = [...UPLOAD_VIDEO_EXTENSIONS, ...UPLOAD_IMAGE_EXTENSIONS];
const ASSET_ACCEPT = ASSET_EXTENSIONS.map((e) => `.${e}`).join(",");

export interface BeitragFormOptions {
  treatments: Array<{ id: string; name: string; isActive: boolean }>;
  assets: Array<{ id: string; title: string; kind: string }>;
}

/**
 * Create a post. With a file chosen, the file goes straight to storage first
 * (server/uploads.ts flow), then one action creates the assets row and the
 * post together and notifies the Praxis ("asset_ready").
 */
export function BeitragCreateForm({ clinicId, options }: { clinicId: string; options: BeitragFormOptions }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // An uploaded but not yet registered file: a retry only re-submits, no second upload.
  const [landed, setLanded] = useState<{ key: string; name: string; file: File } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    fd.delete("file");
    const chosen = file instanceof File && file.size > 0 ? file : null;

    setError(null);
    setSuccess(null);
    if (chosen) {
      const ext = fileExtension(chosen.name);
      if (!ASSET_EXTENSIONS.includes(ext)) {
        setError("Nur Videos (mp4, mov, webm, m4v) und Bilder (png, jpg, webp, heic, gif) sind erlaubt.");
        return;
      }
      if (chosen.size > uploadLimitForExtension(ext)) {
        setError(`Die Datei ist zu groß (höchstens ${formatUploadLimit(ext)}).`);
        return;
      }
      if (fd.get("assetId")) {
        setError("Bitte entweder eine vorhandene Datei wählen oder eine neue hochladen.");
        return;
      }
    }

    busyRef.current = true;
    setBusy(true);
    try {
      if (chosen) {
        let key = landed && landed.file === chosen ? landed.key : null;
        if (!key) {
          const target = await createBeitragUploadTargetAction({
            clinicId,
            name: chosen.name,
            size: chosen.size,
            type: chosen.type,
          });
          if (!target.ok) {
            setError(target.error);
            return;
          }
          setProgress(0);
          try {
            await uploadFileToTarget(target.data, chosen, setProgress);
          } catch (err) {
            setError(uploadErrorMessage(err));
            return;
          }
          key = target.data.key;
          setLanded({ key, name: chosen.name, file: chosen });
        }
        fd.set("uploadKey", key);
        fd.set("uploadName", chosen.name);
      }

      const res = await createBeitragAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLanded(null);
      form.reset();
      setSuccess(
        res.data.linksBuilt
          ? `Beitrag angelegt, Code ${res.data.code}.`
          : `Beitrag angelegt, Code ${res.data.code}. Links fehlen noch: Zielseiten-Adresse fehlt (Stammdaten: Zielseiten-Origin).`
      );
      router.refresh();
    } catch {
      setError("Etwas ist schiefgelaufen. Ihre Eingaben sind noch da, bitte erneut versuchen.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-4 md:grid-cols-12">
      <input type="hidden" name="clinicId" value={clinicId} />
      <div className="md:col-span-6">
        <Label htmlFor="bt-title">Titel</Label>
        <Input id="bt-title" name="title" required maxLength={200} placeholder="z. B. Faltenbehandlung erklärt" />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor="bt-format">Format</Label>
        <select id="bt-format" name="format" defaultValue="reel" className={SELECT_CLASS} required>
          {CONTENT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {CONTENT_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-3">
        <Label htmlFor="bt-treatment">Behandlung</Label>
        <select id="bt-treatment" name="treatmentId" defaultValue="" className={SELECT_CLASS}>
          <option value="">Keine</option>
          {options.treatments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isActive ? "" : " (inaktiv)"}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-12">
        <Label htmlFor="bt-caption">Beitragstext</Label>
        <Textarea id="bt-caption" name="caption" rows={4} maxLength={5000} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 md:col-span-12">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="usesClone" className="h-4 w-4" />
          Mit KI-Klon des Inhabers
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="aiContent" defaultChecked className="h-4 w-4" />
          KI-Inhalt (Kennzeichnung „KI-generiert“)
        </label>
      </div>
      <div className="md:col-span-6">
        <Label htmlFor="bt-asset">Vorhandene Datei (optional)</Label>
        <select id="bt-asset" name="assetId" defaultValue="" className={SELECT_CLASS}>
          <option value="">Keine</option>
          {options.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.kind === "video" ? "Video" : "Bild"})
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-6">
        <Label htmlFor="bt-file">Oder Datei hochladen (optional)</Label>
        <input
          id="bt-file"
          name="file"
          type="file"
          accept={ASSET_ACCEPT}
          disabled={busy}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-secondary file:px-3 file:py-2 file:text-sm"
        />
        <p className="mt-1 text-xs text-fg-secondary">
          Videos bis 2 GB, Bilder bis 100 MB. Die Datei erscheint danach unter Medien der Praxis.
        </p>
      </div>

      {progress !== null && (
        <div className="md:col-span-12">
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-secondary">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-tone-bad md:col-span-12">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="flex items-start gap-1.5 text-sm text-tone-good md:col-span-12">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {success}
        </p>
      )}
      <div className="flex justify-end md:col-span-12">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? (progress !== null ? "Datei wird hochgeladen …" : "Wird angelegt …") : "Beitrag anlegen"}
        </Button>
      </div>
    </form>
  );
}
