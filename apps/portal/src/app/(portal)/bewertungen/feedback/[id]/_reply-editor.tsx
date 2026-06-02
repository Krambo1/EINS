"use client";

import { useRef, useState } from "react";
import { Button } from "@eins/ui";
import { setFeedbackNoteAction } from "../actions";
import {
  REPLY_BUCKET_LABELS,
  REPLY_BUCKET_ORDER,
  bucketForRating,
  templatesByBucket,
  type ReplyBucket,
} from "../../_lib/reply-templates";

/**
 * Client-Editor für die interne Notiz: behält das bestehende Server-Action-
 * Speichern bei, ergänzt aber das Einfügen einer statischen Antwortvorlage
 * in das Textfeld. Die Inhaberin oder der Inhaber passt den Text an und
 * speichert ihn dann über die unveränderte setFeedbackNoteAction.
 *
 * Vorgeschlagen wird zuerst der zur Sternebewertung passende Bucket; alle
 * anderen Buckets bleiben über die Auswahl erreichbar.
 */
export function FeedbackReplyEditor({
  feedbackId,
  rating,
  defaultNote,
}: {
  feedbackId: string;
  rating: number | null;
  defaultNote: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [bucket, setBucket] = useState<ReplyBucket>(bucketForRating(rating));

  function insertTemplate(text: string) {
    const el = textareaRef.current;
    if (!el) return;
    const current = el.value.trim();
    el.value = current ? `${current}\n\n${text}` : text;
    el.focus();
  }

  const templates = templatesByBucket(bucket);

  return (
    <form
      action={setFeedbackNoteAction}
      className="space-y-3 border-t border-border pt-4"
    >
      <input type="hidden" name="id" value={feedbackId} />

      <div className="space-y-2">
        <p className="text-sm font-medium text-fg-primary">
          Antwortvorlage einfügen
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {REPLY_BUCKET_ORDER.map((b) => (
            <Button
              key={b}
              type="button"
              size="sm"
              variant={bucket === b ? "default" : "outline"}
              onClick={() => setBucket(b)}
            >
              {REPLY_BUCKET_LABELS[b]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {templates.map((tpl) => (
            <Button
              key={tpl.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => insertTemplate(tpl.text)}
            >
              {tpl.title}
            </Button>
          ))}
        </div>
      </div>

      <label
        htmlFor="internalNote"
        className="block text-sm font-medium text-fg-primary"
      >
        Interne Notiz (nur Praxis-Team sichtbar)
      </label>
      <textarea
        ref={textareaRef}
        id="internalNote"
        name="internalNote"
        rows={6}
        maxLength={5000}
        defaultValue={defaultNote}
        placeholder="z. B. Patient:in zurückgerufen am 12.04., Beschwerde berechtigt, Ablauf intern besprochen. Oder eine Antwortvorlage einfügen und anpassen."
        className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2 text-sm"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm">
          Notiz speichern
        </Button>
      </div>
    </form>
  );
}
