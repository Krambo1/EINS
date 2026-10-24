"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@eins/ui";
import { AlertCircle, Loader2 } from "lucide-react";
import { fileExtension } from "@/lib/uploads";
import { uploadErrorMessage, uploadFileToTarget } from "@/lib/upload-client";
import {
  CLONE_DOCUMENT_ACCEPT,
  MAX_CLONE_DOCUMENT_BYTES,
  isCloneDocumentExtension,
} from "@/lib/clone-record";
import { createKlonDocumentTargetAction, saveKlonDocumentAction } from "../klon-actions";

/**
 * Consent or training opt-out of one KI-Klon record: the file goes straight
 * to storage under klon/<clinicId>/ (admin only), then one action stores the
 * key and the date. Same two-step flow as BeitragCreateForm.
 */
export function KlonDocumentForm({
  clinicId,
  recordId,
  kind,
  today,
}: {
  clinicId: string;
  recordId: string;
  kind: "einwilligung" | "widerspruch";
  today: string;
}) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState<{ key: string; file: File } | null>(null);

  const ids = `klon-${kind}-${recordId}`;
  const dayLabel = kind === "einwilligung" ? "Unterschrieben am" : "Widerspruch bestätigt am";
  const fileLabel = kind === "einwilligung" ? "Unterschriebene Einwilligung" : "Nachweis des Trainings-Widerspruchs";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    const day = String(fd.get("day") ?? "");
    const chosen = file instanceof File && file.size > 0 ? file : null;
    setError(null);
    if (!chosen) {
      setError("Bitte wählen Sie die Datei aus.");
      return;
    }
    if (!isCloneDocumentExtension(fileExtension(chosen.name))) {
      setError("Nur PDF oder Foto (png, jpg, webp, heic) sind erlaubt.");
      return;
    }
    if (chosen.size > MAX_CLONE_DOCUMENT_BYTES) {
      setError("Die Datei ist zu groß (höchstens 25 MB).");
      return;
    }
    if (kind === "widerspruch" && fd.get("confirmed") !== "on") {
      setError("Bitte bestätigen Sie, dass der Widerspruch beim Werkzeug wirksam ist.");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      let key = landed && landed.file === chosen ? landed.key : null;
      if (!key) {
        const target = await createKlonDocumentTargetAction({
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
        setLanded({ key, file: chosen });
      }
      const res = await saveKlonDocumentAction({ clinicId, id: recordId, kind, day, documentKey: key });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLanded(null);
      form.reset();
      router.refresh();
    } catch {
      setError("Etwas ist schiefgelaufen. Bitte erneut versuchen.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-12">
      <div className="md:col-span-7">
        <Label htmlFor={`${ids}-file`}>{fileLabel}</Label>
        <Input id={`${ids}-file`} name="file" type="file" accept={CLONE_DOCUMENT_ACCEPT} required />
      </div>
      <div className="md:col-span-5">
        <Label htmlFor={`${ids}-day`}>{dayLabel}</Label>
        <Input id={`${ids}-day`} name="day" type="date" max={today} defaultValue={today} required />
      </div>
      {kind === "widerspruch" && (
        <label className="flex items-start gap-2 text-sm text-fg-primary md:col-span-12">
          <input type="checkbox" name="confirmed" className="mt-1" required />
          <span>Der Widerspruch gegen das Training mit diesen Daten ist beim Werkzeug eingereicht und bestätigt.</span>
        </label>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-tone-bad md:col-span-12">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3 md:col-span-12">
        {progress !== null && (
          <span className="text-sm tabular-nums text-fg-secondary">{Math.round(progress * 100)} %</span>
        )}
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </form>
  );
}
