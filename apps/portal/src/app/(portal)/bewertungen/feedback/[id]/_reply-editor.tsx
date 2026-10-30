"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, Lock } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@eins/ui";
import { formatNumber } from "@/lib/formatting";
import { CONTROL, RAISED_CONTROL } from "../../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../../_components/flash-event";
import { setFeedbackNoteAction } from "../actions";
import {
  REPLY_BUCKET_ORDER,
  bucketForRating,
  fillTemplate,
  templatesByBucket,
} from "../../_lib/reply-templates";
import { BUCKET_SWITCH_LABELS } from "../../_components/ReplyTemplatesCard";
import { NOTE_HEIGHT } from "../../_lib/sizes";
import { ScrollHint } from "@/app/_components/ScrollHint";

const MAX = 5000;

/** The menu panel of the Anfragen filters. */
const MENU =
  "max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[15rem] overflow-auto rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]";

/**
 * The internal note with the reply templates. A template goes in where the
 * cursor stands (Help Scout's saved replies), the Praxis name already
 * filled in; the group that fits the stars comes first in the menu.
 * "Notiz speichern" (or Strg+Enter) saves with one tap and counts as saved at
 * once, the toast confirms; on failure "Nicht gespeichert" comes back, the
 * typed text stays and the toast says why. Fixed height: a
 * long note scrolls inside, the buttons never move.
 */
export function FeedbackReplyEditor({
  feedbackId,
  rating,
  defaultNote,
  praxisName,
}: {
  feedbackId: string;
  rating: number | null;
  defaultNote: string;
  praxisName: string | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [note, setNote] = useState(defaultNote);
  const [saved, setSaved] = useState(defaultNote);
  const [pending, startTransition] = useTransition();
  const dirty = note !== saved;

  const suggested = bucketForRating(rating);
  const buckets = [suggested, ...REPLY_BUCKET_ORDER.filter((b) => b !== suggested)];

  function insertTemplate(text: string) {
    const el = textareaRef.current;
    const filled = fillTemplate(text, { praxisname: praxisName });
    const start = el?.selectionStart ?? note.length;
    const end = el?.selectionEnd ?? note.length;
    const before = note.slice(0, start);
    const after = note.slice(end);
    // A blank line between the template and text around it.
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const trail = after && !after.startsWith("\n") ? "\n\n" : "";
    const next = `${before}${lead}${filled}${trail}${after}`.slice(0, MAX);
    setNote(next);
    const caret = Math.min((before + lead + filled).length, next.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = note;
    const previous = saved;
    // Counts as saved on the tap; a failure puts "Nicht gespeichert" back.
    const undo = () => setSaved((s) => (s === text ? previous : s));
    setSaved(text);
    startTransition(async () => {
      try {
        const res = await setFeedbackNoteAction(undefined, fd);
        if (res?.ok) {
          showActionFlash({ tone: "good", title: "Notiz gespeichert" });
        } else {
          undo();
          showActionFlash({
            tone: "bad",
            title: "Notiz nicht gespeichert",
            description: res && !res.ok ? res.error : undefined,
          });
        }
      } catch {
        undo();
        showActionFlash({
          tone: "bad",
          title: "Keine Verbindung",
          description: "Die Notiz wurde nicht gespeichert. Ihr Text bleibt stehen, tippen Sie gleich noch einmal auf Speichern.",
        });
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit}>
      <input type="hidden" name="id" value={feedbackId} />

      <div className="flex h-[var(--control-h)] items-center justify-between gap-3">
        <label htmlFor="internalNote" className="min-w-0 text-sm leading-5">
          <span className="font-medium text-fg-primary">Interne Notiz</span>
          <span className="ml-2 inline-flex items-center gap-1 text-fg-secondary">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Nur für Ihr Team
          </span>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              RAISED_CONTROL,
              CONTROL,
              "inline-flex shrink-0 items-center gap-1.5 border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            )}
          >
            Vorlage einfügen
            <ChevronDown className="h-4 w-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={MENU}
            onCloseAutoFocus={(e) => {
              // The caret goes back into the note, not onto the trigger.
              e.preventDefault();
              textareaRef.current?.focus();
            }}
          >
            {buckets.map((b, i) => (
              <div key={b}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-fg-secondary">
                  {BUCKET_SWITCH_LABELS[b]}
                  {b === suggested && rating != null && " (passt zu dieser Bewertung)"}
                </DropdownMenuLabel>
                {templatesByBucket(b).map((tpl) => (
                  <DropdownMenuItem key={tpl.id} onSelect={() => insertTemplate(tpl.text)}>
                    {tpl.title}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollHint className="mt-2" watch={note}>
        <textarea
          ref={textareaRef}
          id="internalNote"
          name="internalNote"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          maxLength={MAX}
          placeholder="Zum Beispiel: Patientin am 12.04. zurückgerufen, Ablauf intern besprochen. Oder oben eine Vorlage einfügen und anpassen."
          className={cn(
            "scroll-shadows elev-inset block w-full resize-none rounded-[var(--r-panel)] border-0 px-4 py-3 text-[15px] leading-6 text-fg-primary placeholder:text-fg-tertiary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            NOTE_HEIGHT
          )}
        />
      </ScrollHint>

      <div className="mt-3 flex h-[var(--control-h)] items-center justify-between gap-3">
        <p className="min-w-0 text-sm leading-5" aria-live="polite">
          {dirty ? (
            <span className="font-medium text-tone-warn">Nicht gespeichert</span>
          ) : (
            <span className="tabular-nums text-fg-secondary">
              {formatNumber(note.length)} von {formatNumber(MAX)} Zeichen
            </span>
          )}
        </p>
        <Button type="submit" disabled={pending} className={cn(CONTROL, "shrink-0 px-4")} title="Strg+Enter">
          Notiz speichern
        </Button>
      </div>
    </form>
  );
}
