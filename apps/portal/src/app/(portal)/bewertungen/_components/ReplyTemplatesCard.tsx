"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button, cn } from "@eins/ui";
import {
  CARD_TITLE,
  CONTROL,
  QUIET_CONTROL,
  RAISED_CONTROL,
  TABLE_HEAD_BAND,
} from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { RatingStars } from "../../_components/RatingStars";
import { ScrollHint } from "@/app/_components/ScrollHint";
import {
  REPLY_BUCKET_ORDER,
  REPLY_BUCKET_STARS,
  allReplyTemplates,
  fillTemplate,
  standardReplyTemplate,
  templateParts,
  templatesByBucket,
  type ReplyBucket,
  type ReplyTemplate,
} from "../_lib/reply-templates";
import { TEMPLATE_TEXT_MAX, TEMPLATE_TITLE_MAX } from "../_lib/reply-templates-store";
import { NOTE_HEIGHT, TEMPLATE_GROUP_GAP, TEMPLATE_ROW, TEMPLATE_ROW_BOX } from "../_lib/sizes";
import { updateReplyTemplatesAction } from "../actions";

/** Short names of the groups: the stars say which reviews a group fits. */
export const BUCKET_SWITCH_LABELS: Record<ReplyBucket, string> = {
  positiv: REPLY_BUCKET_STARS.positiv.label,
  neutral: REPLY_BUCKET_STARS.neutral.label,
  kritisch: REPLY_BUCKET_STARS.kritisch.label,
};

/** The note editor's field look: pressed into the card. */
const FIELD =
  "elev-inset block w-full rounded-[var(--r-panel)] border-0 bg-[var(--well)] text-[15px] text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A template being written: an existing one, or a new own one (`isNew`). */
interface Draft {
  id: string;
  bucket: ReplyBucket;
  title: string;
  text: string;
  isNew: boolean;
}

/** The list with one template put in, replaced or (with null) taken out. */
function withTemplate(list: ReplyTemplate[], id: string, next: ReplyTemplate | null): ReplyTemplate[] {
  const at = list.findIndex((t) => t.id === id);
  if (!next) return at < 0 ? list : list.filter((t) => t.id !== id);
  if (at >= 0) return list.map((t) => (t.id === id ? next : t));
  // A new one goes last in its group.
  const lastOfGroup = list.map((t) => t.bucket).lastIndexOf(next.bucket);
  const copy = [...list];
  copy.splice(lastOfGroup + 1, 0, next);
  return copy;
}

/**
 * Antwortvorlagen as one reading list (Karam, 2026-10-30: no switch, scroll
 * instead of click, expandable and customizable), built like the Leitfaden
 * (DESIGN.md section 9): each group under Linear's pressed group band with
 * its stars, every template a GOV.UK accordion row of 56 px (title, chevron
 * at the end). An opened row shows the text in Vercel's code-block well,
 * "Kopieren" in its head, and pushes the rows below down. The Praxis name is
 * filled in and what is left to replace is marked (Synup's filled wildcards,
 * Help Scout's variables).
 *
 * With `canEdit` (Help Scout's saved replies): "Bearbeiten" swaps the well
 * for the fields in place, "Original wiederherstellen" on a changed standard
 * template, "Löschen" on an own one, "Eigene Vorlage" per group. Every save
 * shows on the tap and rolls back alone if the server says no (section 10).
 */
export function ReplyTemplatesCard({
  praxisName = null,
  templates: initial,
  canEdit = false,
}: {
  praxisName?: string | null;
  /** The Praxis's merged templates (`mergeReplyTemplates`); default the shipped ones. */
  templates?: ReplyTemplate[];
  canEdit?: boolean;
}) {
  const [templates, setTemplates] = useState<ReplyTemplate[]>(() => initial ?? allReplyTemplates());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<Draft | null>(null);

  function setOpenFor(id: string, value: boolean) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Shows `optimistic` for template `id` at once, then sends `op`. On success
   * the server's version of that one template replaces it; on failure exactly
   * this change goes back and the toast names the template.
   */
  function commit(
    op: Parameters<typeof updateReplyTemplatesAction>[0],
    id: string,
    optimistic: ReplyTemplate | null,
    toast: { title: string; name: string; undo?: () => void },
    onFail?: () => void
  ) {
    // Read from the current list, not this render's: an "Rückgängig" in a
    // toast runs after later changes.
    let before: ReplyTemplate | null = null;
    setTemplates((cur) => {
      before = cur.find((t) => t.id === id) ?? null;
      return withTemplate(cur, id, optimistic);
    });
    const rollBack = (description: string) => {
      setTemplates((cur) => withTemplate(cur, id, before));
      onFail?.();
      showActionFlash({ tone: "bad", title: `${toast.name}: nicht gespeichert`, description });
    };
    void updateReplyTemplatesAction(op).then(
      (res) => {
        if (!res.ok) return rollBack(res.error);
        setTemplates((cur) => withTemplate(cur, id, res.templates.find((t) => t.id === id) ?? null));
        showActionFlash({
          tone: "good",
          title: toast.title,
          description: toast.name,
          action: toast.undo ? { label: "Rückgängig", onClick: toast.undo } : undefined,
        });
      },
      () => rollBack("Keine Verbindung. Versuchen Sie es gleich noch einmal.")
    );
  }

  function save(d: Draft) {
    const standard = standardReplyTemplate(d.id);
    const title = d.title.trim();
    const text = d.text.trim();
    const origin: ReplyTemplate["origin"] = !standard
      ? "custom"
      : standard.title === title && standard.text === text
        ? "standard"
        : "edited";
    setDraft(null);
    setOpenFor(d.id, true);
    commit(
      { op: "save", id: d.id, bucket: d.bucket, title, text },
      d.id,
      { id: d.id, bucket: d.bucket, title, text, origin },
      { title: d.isNew ? "Vorlage hinzugefügt" : "Vorlage gespeichert", name: title },
      // The fields come back with what was typed.
      () => setDraft(d)
    );
  }

  function reset(tpl: ReplyTemplate) {
    const standard = standardReplyTemplate(tpl.id);
    if (!standard) return;
    commit(
      { op: "reset", id: tpl.id },
      tpl.id,
      { ...standard, origin: "standard" },
      {
        title: "Original wiederhergestellt",
        name: standard.title,
        undo: () => save({ id: tpl.id, bucket: tpl.bucket, title: tpl.title, text: tpl.text, isNew: false }),
      }
    );
  }

  function remove(tpl: ReplyTemplate) {
    commit({ op: "delete", id: tpl.id }, tpl.id, null, {
      title: "Vorlage gelöscht",
      name: tpl.title,
      undo: () => save({ id: tpl.id, bucket: tpl.bucket, title: tpl.title, text: tpl.text, isNew: true }),
    });
  }

  return (
    <section className="anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 [--delay:60ms] md:px-6 md:pb-6 md:pt-6">
      <h2 className={CARD_TITLE}>Antwortvorlagen</h2>
      <p className="mt-1 text-sm leading-5 text-fg-secondary">
        Ersetzen Sie die markierten Stellen, bevor Sie antworten.
      </p>

      <div className="mt-5">
        {REPLY_BUCKET_ORDER.map((bucket, i) => {
          const list = templatesByBucket(bucket, templates);
          const newDraft = draft?.isNew && draft.bucket === bucket ? draft : null;
          const { label, stars } = REPLY_BUCKET_STARS[bucket];
          return (
            <section key={bucket} aria-label={`Vorlagen für ${label}`} className={cn(i > 0 && TEMPLATE_GROUP_GAP)}>
              {/* Linear's group header, pressed into the card. */}
              <h3 className={cn(TABLE_HEAD_BAND, "flex items-center gap-2.5 px-3 font-medium text-fg-primary")}>
                <RatingStars rating={stars} size={14} />
                {label}
              </h3>
              <ul className="divide-y divide-border">
                {list.map((tpl) => (
                  <TemplateRow
                    key={tpl.id}
                    tpl={tpl}
                    text={fillTemplate(tpl.text, { praxisname: praxisName })}
                    open={open.has(tpl.id) || draft?.id === tpl.id}
                    onToggle={() => setOpenFor(tpl.id, !open.has(tpl.id))}
                    canEdit={canEdit}
                    editing={draft && !draft.isNew && draft.id === tpl.id ? draft : null}
                    onEdit={() => setDraft({ id: tpl.id, bucket, title: tpl.title, text: tpl.text, isNew: false })}
                    onDraftChange={setDraft}
                    onSave={save}
                    onCancel={() => setDraft(null)}
                    onReset={() => reset(tpl)}
                    onDelete={() => remove(tpl)}
                  />
                ))}
                {newDraft && (
                  <li className="pb-3 pt-2">
                    <TemplateEditor draft={newDraft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />
                  </li>
                )}
              </ul>
              {canEdit && !newDraft && (
                <button
                  type="button"
                  aria-label={`Eigene Vorlage für ${label} anlegen`}
                  className={cn(QUIET_CONTROL, "-ml-2.5")}
                  onClick={() =>
                    setDraft({ id: `eigene-${crypto.randomUUID()}`, bucket, title: "", text: "", isNew: true })
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Eigene Vorlage
                </button>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function TemplateRow({
  tpl,
  text,
  open,
  onToggle,
  canEdit,
  editing,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onReset,
  onDelete,
}: {
  tpl: ReplyTemplate;
  text: string;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  editing: Draft | null;
  onEdit: () => void;
  onDraftChange: (d: Draft) => void;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const rowId = useId();
  const panelId = useId();
  return (
    <li className={TEMPLATE_ROW}>
      {/* Only the row itself washes grey: the open text is a well of its
          own under it, never grey on grey. "Kopieren" sits in the row
          (Karam, 2026-10-30), so a template copies without opening it. */}
      <div className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-2 pr-3">
        <button
          type="button"
          id={rowId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-[var(--r-control)] px-3 text-left transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            TEMPLATE_ROW_BOX
          )}
        >
          <span className="min-w-0 flex-1 text-[15px] font-medium leading-5 text-fg-primary">
            {tpl.title}
            {tpl.origin === "edited" && <span className="ml-2 text-sm font-normal text-fg-secondary">Angepasst</span>}
            {tpl.origin === "custom" && <span className="ml-2 text-sm font-normal text-fg-secondary">Eigene</span>}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("h-4 w-4 shrink-0 text-fg-tertiary transition-transform", open && "rotate-180")}
          />
        </button>
        <CopyTemplateButton text={text} title={tpl.title} />
      </div>
      {open && (
        <div id={panelId} role="region" aria-labelledby={rowId} className="pb-3 pt-1">
          {editing ? (
            <TemplateEditor draft={editing} onChange={onDraftChange} onSave={onSave} onCancel={onCancel} />
          ) : (
            <>
              <TemplateWell text={text} />
              {canEdit && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <button type="button" className={cn(QUIET_CONTROL, "-ml-2.5")} onClick={onEdit}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    Bearbeiten
                  </button>
                  {tpl.origin === "edited" && (
                    <button type="button" className={QUIET_CONTROL} onClick={onReset}>
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Original wiederherstellen
                    </button>
                  )}
                  {tpl.origin === "custom" && (
                    <button type="button" className={QUIET_CONTROL} onClick={onDelete}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Löschen
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** The text in Vercel's code-block well, 12 px from every grey edge (DESIGN.md section 5). */
function TemplateWell({ text }: { text: string }) {
  return (
    <div className="elev-inset overflow-hidden rounded-[var(--r-panel)] bg-[var(--well)]">
      <p className="whitespace-pre-wrap break-words p-3 text-[15px] leading-6 text-fg-primary">
        <TemplateText text={text} />
      </p>
    </div>
  );
}

/** Title and text of one template, as written (placeholders included). */
function TemplateEditor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const textId = useId();
  const ready = draft.title.trim().length > 0 && draft.text.trim().length > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <label htmlFor={titleId} className="text-sm font-medium leading-5 text-fg-primary">
        Titel
      </label>
      <input
        id={titleId}
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        maxLength={TEMPLATE_TITLE_MAX}
        autoFocus={draft.isNew}
        className={cn(FIELD, CONTROL, "mt-1.5 px-3")}
      />
      <label htmlFor={textId} className="mt-3 block text-sm font-medium leading-5 text-fg-primary">
        Text
      </label>
      <ScrollHint className="mt-1.5" watch={draft.text}>
        <textarea
          id={textId}
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready) {
              e.preventDefault();
              onSave(draft);
            }
          }}
          maxLength={TEMPLATE_TEXT_MAX}
          autoFocus={!draft.isNew}
          placeholder="Liebe/r [Vorname], vielen Dank für Ihre Bewertung."
          className={cn(FIELD, "scroll-shadows resize-none px-4 py-3 leading-6", NOTE_HEIGHT)}
        />
      </ScrollHint>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} className={cn(RAISED_CONTROL, CONTROL, "px-4")}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={!ready} className={cn(CONTROL, "px-4")} title="Strg+Enter">
          Speichern
        </Button>
      </div>
    </form>
  );
}

/** The text with each placeholder still to replace marked. */
export function TemplateText({ text }: { text: string }) {
  return (
    <>
      {templateParts(text).map((part, i) =>
        part.placeholder ? (
          <mark
            key={i}
            className="rounded-[var(--r-mark)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] px-0.5 text-fg-primary"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

/**
 * One tap copies; the toast confirms. The button keeps its label and width,
 * only the icon turns into a tick for a moment.
 */
function CopyTemplateButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      showActionFlash({ tone: "good", title: "Vorlage kopiert", description: title });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht kopiert",
        description: "Ihr Browser hat das Kopieren nicht erlaubt. Markieren Sie den Text und kopieren Sie ihn selbst.",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      aria-label={`${title} kopieren`}
      className={cn(RAISED_CONTROL, CONTROL, "shrink-0 px-3.5")}
    >
      {copied ? <Check className="h-4 w-4 text-tone-good" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      Kopieren
    </Button>
  );
}
