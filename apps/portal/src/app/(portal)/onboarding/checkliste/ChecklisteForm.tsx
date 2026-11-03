"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Trash2, Upload, X } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { uploadErrorMessage, uploadFileToTarget } from "@/lib/upload-client";
import { CONTROL, CONTROL_SQUARE, RAISED_CONTROL, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { PendingSubmit } from "../../_components/PendingSubmit";
import { FIELD } from "../../einstellungen/_lib/sizes";
import { FILE_ROW, FileRow, FileTypeIcon, MetaFacts, formatFileSize } from "../../dateien/_components/file-ui";
import { SectionRail, useActiveSection } from "../_components/SectionRail";
import { StatusWord } from "../_components/StatusWord";
import {
  COLUMNS,
  FIELD_LABEL,
  ITEM_PANEL,
  ITEM_ROW,
  ITEM_WELL,
  OPTION_INPUT,
  OPTION_ROW,
  TEXTAREA_HEIGHT,
} from "../_lib/sizes";
import {
  CHECKLIST_BLOCKS,
  MAX_CHECKLIST_UPLOAD_BYTES,
  UPLOAD_PROFILES,
  itemAcceptsLink,
  itemAcceptsUpload,
  validateChecklistFields,
  type ChecklistAnswer,
  type ChecklistItem,
  type ChecklistStatus,
} from "./content";
import {
  createChecklistUploadTargetAction,
  finalizeChecklistFileAction,
  removeChecklistFile,
  saveChecklistItem,
} from "./actions";
import { BlockCard, ItemRowContent, blockAnchorId, blockStatus } from "./parts";

export interface ClientChecklistFile {
  id: string;
  name: string;
  sizeBytes: number;
  url: string;
}

export interface ClientChecklistItemState {
  status: ChecklistStatus;
  answer: ChecklistAnswer;
  files: ClientChecklistFile[];
  /** ISO string, set once EINS has confirmed the item. */
  verifiedAt: string | null;
  /** ISO string of the row's last change; the item takes the server's answer again when it moves. */
  updatedAt: string | null;
}

export type ClientChecklistState = Record<string, ClientChecklistItemState>;

const EMPTY_STATE: ClientChecklistItemState = { status: "offen", answer: {}, files: [], verifiedAt: null, updatedAt: null };

const rowId = (id: string) => `punkt-${id}`;

/**
 * The blocks with their items, and from xl the rail beside them. One item is
 * open at a time (Shopify's setup guide); the tapped row stays where it was
 * when the item above it closes. `after` is the page's closing cards.
 */
export function ChecklisteForm({ initialState, after }: { initialState: ClientChecklistState; after?: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const active = useActiveSection(CHECKLIST_BLOCKS.map((b) => blockAnchorId(b.key)));
  const statusOf = (id: string) => initialState[id]?.status;

  function toggle(id: string, row: HTMLElement) {
    anchor.current = { id, top: row.getBoundingClientRect().top };
    setOpenId((cur) => (cur === id ? null : id));
  }

  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a) return;
    const row = document.getElementById(rowId(a.id));
    if (!row) return;
    const delta = row.getBoundingClientRect().top - a.top;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }, [openId]);

  return (
    <div className={COLUMNS}>
      <div className="space-y-4 md:space-y-6">
        {CHECKLIST_BLOCKS.map((block) => (
          <BlockCard key={block.key} block={block} status={<StatusWord status={blockStatus(block, statusOf)} />}>
            {block.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                state={initialState[item.id] ?? EMPTY_STATE}
                open={openId === item.id}
                onToggle={toggle}
              />
            ))}
          </BlockCard>
        ))}
        {after}
      </div>
      <SectionRail
        active={active}
        entries={CHECKLIST_BLOCKS.map((b) => ({ id: blockAnchorId(b.key), title: b.title, status: blockStatus(b, statusOf) }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------
// One item
// ---------------------------------------------------------------

/** What a tap on a toggle shows before the server has answered. */
interface Optimistic {
  status: ChecklistStatus;
  selfChecked: boolean;
  entfaellt: boolean;
}

/** A file on its way: bytes in flight, then registered with EINS. */
interface InFlight {
  id: string;
  name: string;
  size: number;
  progress: number;
  /** Registered; the row stays until the refreshed item brings the file. */
  done: boolean;
}

/**
 * One item: the row (title, status, chevron) and, when open, the Anleitung
 * in a well with the controls under it. Toggles show on the tap and save in
 * the background (optimistic, rolled back with a toast on failure); files
 * show their progress until EINS has registered them; typed answers save
 * with "Speichern", which greys out while it runs. Saves and errors go in
 * the toast.
 */
function ItemRow({
  item,
  state,
  open,
  onToggle,
}: {
  item: ChecklistItem;
  state: ClientChecklistItemState;
  open: boolean;
  onToggle: (id: string, row: HTMLElement) => void;
}) {
  const [, start] = useTransition();
  const [answer, setAnswer] = useState<ChecklistAnswer>(state.answer);
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const [uploads, setUploads] = useState<InFlight[]>([]);
  const [removing, setRemoving] = useState(0);
  const [dragging, setDragging] = useState(false);
  // A second tap on a toggle while a save runs is ignored (the server
  // computes the status from the whole item, so two saves must not race).
  const saving = useRef(false);
  const controllers = useRef(new Map<string, AbortController>());
  const fileRef = useRef<HTMLInputElement>(null);

  // The saved row landed (own save, EINS's check, a second person): take the
  // server's answer, drop what a tap showed ahead and the registered uploads.
  const [seen, setSeen] = useState(state.updatedAt);
  if (seen !== state.updatedAt) {
    setSeen(state.updatedAt);
    setAnswer(state.answer);
    setOptimistic(null);
    setUploads((u) => u.filter((f) => !f.done));
  }

  const busyWithFiles = uploads.some((u) => !u.done) || removing > 0;
  const shownStatus = optimistic?.status ?? state.status;
  const entfaellt = optimistic?.entfaellt ?? state.status === "entfaellt";
  const selfChecked = optimistic?.selfChecked ?? (state.status === "geliefert" || state.status === "geprueft");
  const keineVorhanden = answer.keineVorhanden === true;
  const profile = item.uploadProfile ? UPLOAD_PROFILES[item.uploadProfile] : null;
  const fieldErrors = validateChecklistFields(item, answer);

  // Closing or reloading the tab mid-upload would lose the files: the
  // browser asks first (Dateien, WeTransfer, Drive).
  const uploadingNow = uploads.some((u) => !u.done);
  useEffect(() => {
    if (!uploadingNow) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [uploadingNow]);

  function fail(title: string, description?: string) {
    showActionFlash({ tone: "bad", title, description });
  }

  /** Saves the item; `revert` undoes what a tap showed ahead of the save. */
  async function save(
    opts: { answer?: ChecklistAnswer; selfChecked?: boolean; nichtVorhanden?: boolean },
    revert?: () => void,
    savedTitle?: string
  ) {
    const toSave = opts.answer ?? answer;
    const firstError = Object.values(validateChecklistFields(item, toSave))[0];
    if (firstError) {
      revert?.();
      fail("Nicht gespeichert", firstError);
      return;
    }
    saving.current = true;
    try {
      const res = await saveChecklistItem({
        itemId: item.id,
        answer: toSave,
        selfChecked: opts.selfChecked,
        nichtVorhanden: opts.nichtVorhanden,
      });
      // Success: the action revalidates the page.
      if (!res.ok) {
        revert?.();
        fail("Nicht gespeichert", res.field ? res.error : saveErrorText(res.error));
      } else if (savedTitle) {
        showActionFlash({ tone: "good", title: savedTitle, description: item.title });
      }
    } catch {
      revert?.();
      fail("Nicht gespeichert", saveErrorText("network"));
    } finally {
      saving.current = false;
    }
  }

  /** Flips a toggle at once and saves in the background. */
  function tapToggle(show: Optimistic, opts: { answer?: ChecklistAnswer; selfChecked?: boolean; nichtVorhanden?: boolean }, revert?: () => void) {
    if (saving.current) return;
    setOptimistic(show);
    start(() =>
      save(opts, () => {
        setOptimistic(null);
        revert?.();
      })
    );
  }

  function patchUpload(id: string, changes: Partial<InFlight>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }

  /** One file: mint a target, send the bytes straight to storage, register it. */
  async function uploadOne(file: File) {
    if (file.size === 0) return fail("Nicht hochgeladen", `„${file.name}“: ${uploadErrorText("empty_file")}`);
    if (file.size > MAX_CHECKLIST_UPLOAD_BYTES) return fail("Nicht hochgeladen", `„${file.name}“: ${uploadErrorText("file_too_large")}`);
    const id = crypto.randomUUID();
    const ctrl = new AbortController();
    controllers.current.set(id, ctrl);
    setUploads((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0, done: false }]);
    let registered = false;
    try {
      // The bytes never pass through a server action (serverless request caps).
      const minted = await createChecklistUploadTargetAction({
        itemId: item.id,
        filename: file.name,
        size: file.size,
        contentType: file.type || undefined,
      });
      if (!minted.ok) return fail("Nicht hochgeladen", `„${file.name}“: ${uploadErrorText(minted.error)}`);
      try {
        await uploadFileToTarget(minted.target, file, (p) => patchUpload(id, { progress: p }), ctrl.signal);
      } catch (err) {
        if (!ctrl.signal.aborted) fail("Nicht hochgeladen", `„${file.name}“: ${uploadErrorMessage(err)}`);
        return;
      }
      const res = await finalizeChecklistFileAction({
        itemId: item.id,
        key: minted.target.key,
        filename: file.name,
        contentType: file.type || undefined,
      });
      if (!res.ok) return fail("Nicht hochgeladen", `„${file.name}“: ${uploadErrorText(res.error)}`);
      registered = true;
      showActionFlash({ tone: "good", title: "Datei hochgeladen", description: file.name });
    } catch {
      fail("Nicht hochgeladen", `„${file.name}“: ${uploadErrorText("network")}`);
    } finally {
      controllers.current.delete(id);
      if (registered) patchUpload(id, { done: true, progress: 1 });
      else setUploads((prev) => prev.filter((u) => u.id !== id));
    }
  }

  async function uploadAll(files: File[]) {
    for (const f of files) await uploadOne(f);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void uploadAll(files);
  }

  const acceptsFiles = itemAcceptsUpload(item.deliveryType) && !keineVorhanden;
  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  function setField(key: string, value: string) {
    setAnswer((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <li className={WASH_ROW}>
      <button
        type="button"
        id={rowId(item.id)}
        aria-expanded={open}
        aria-controls={`${rowId(item.id)}-inhalt`}
        onClick={(e) => onToggle(item.id, e.currentTarget)}
        className={ITEM_ROW}
      >
        <ItemRowContent item={item} meta={{ status: shownStatus, files: state.files.length }} open={open} />
      </button>

      {open && (
        <div
          id={`${rowId(item.id)}-inhalt`}
          role="region"
          aria-labelledby={rowId(item.id)}
          className={cn(ITEM_PANEL, "rounded-[var(--r-panel)]", dragging && "ring-2 ring-inset ring-accent")}
          // Files dropped onto the opened item go up (Dateien's drop, one item);
          // while files go up a drop is refused, not opened by the browser.
          onDragOver={(e) => {
            if (!acceptsFiles || !isFileDrag(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = busyWithFiles ? "none" : "copy";
            setDragging(!busyWithFiles);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            if (!acceptsFiles || !isFileDrag(e)) return;
            e.preventDefault();
            setDragging(false);
            if (!busyWithFiles) void uploadAll(Array.from(e.dataTransfer.files));
          }}
        >
          <div className={ITEM_WELL}>
            <p className="whitespace-pre-line text-[15px] leading-6 text-fg-primary">{item.anleitung}</p>
            {item.warum && (
              <p className="mt-3 text-sm leading-5 text-fg-secondary">
                <span className="font-medium text-fg-primary">Warum:</span> {item.warum}
              </p>
            )}
          </div>

          <div className="mt-4 space-y-5">
            {item.allowKeineVorhanden && (
              <Toggle
                label="Keine vorhanden"
                checked={keineVorhanden}
                disabled={busyWithFiles}
                onChange={() => {
                  if (saving.current) return;
                  const previous = answer;
                  const next = { ...answer, keineVorhanden: !keineVorhanden };
                  setAnswer(next);
                  const stillThere = state.files.length > 0 || Boolean(state.answer.link);
                  tapToggle(
                    { status: next.keineVorhanden || stillThere ? "geliefert" : "offen", selfChecked, entfaellt },
                    { answer: next },
                    () => setAnswer(previous)
                  );
                }}
              />
            )}

            {!keineVorhanden && (
              <>
                {(item.deliveryType === "status" || item.deliveryType === "einladung") && (
                  <Toggle
                    label={item.deliveryType === "einladung" ? "Einladung verschickt" : "Erledigt"}
                    checked={selfChecked}
                    disabled={entfaellt || busyWithFiles}
                    onChange={() =>
                      tapToggle(
                        { status: selfChecked ? "offen" : "geliefert", selfChecked: !selfChecked, entfaellt: false },
                        { selfChecked: !selfChecked }
                      )
                    }
                  />
                )}

                {itemAcceptsUpload(item.deliveryType) && (
                  <div>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      accept={profile?.accept}
                      className="sr-only"
                      tabIndex={-1}
                      onChange={onPick}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      // Greyed while files go up; their rows show the progress.
                      disabled={busyWithFiles}
                      onClick={() => fileRef.current?.click()}
                      className={cn(RAISED_CONTROL, CONTROL, "px-4")}
                    >
                      <Upload className="h-4 w-4" aria-hidden />
                      {state.files.length > 0 ? "Weitere Datei" : "Datei hochladen"}
                    </Button>
                    {profile && (
                      <p className="mt-2 text-sm leading-5 text-fg-secondary">{profile.hint}, höchstens 25 MB pro Datei.</p>
                    )}
                    {(state.files.length > 0 || uploads.length > 0) && (
                      // Dateien's file rows (their grey reaches 12 px past the
                      // text, 4 px white between two); the files on their way under them.
                      <ul className="mt-3 space-y-1">
                        {state.files.map((f) => (
                          <FileRow
                            key={f.id}
                            icon={<FileTypeIcon name={f.name} />}
                            name={f.name}
                            href={f.url}
                            meta={<MetaFacts parts={[formatFileSize(f.sizeBytes)]} />}
                            action={
                              <RemoveFile
                                fileId={f.id}
                                name={f.name}
                                onStart={() => setRemoving((n) => n + 1)}
                                onEnd={() => setRemoving((n) => n - 1)}
                              />
                            }
                          />
                        ))}
                        {uploads.map((u) => (
                          <UploadingRow
                            key={u.id}
                            file={u}
                            onCancel={() => controllers.current.get(u.id)?.abort()}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {itemAcceptsLink(item.deliveryType) && (
                  <div>
                    <label htmlFor={`${item.id}-link`} className={FIELD_LABEL}>
                      {itemAcceptsUpload(item.deliveryType) ? "Oder Freigabe-Link (für große Sets)" : "Freigabe-Link"}
                    </label>
                    <input
                      id={`${item.id}-link`}
                      type="url"
                      inputMode="url"
                      placeholder="https://drive.google.com/…"
                      value={typeof answer.link === "string" ? answer.link : ""}
                      aria-invalid={fieldErrors.link ? true : undefined}
                      aria-describedby={fieldErrors.link ? `${item.id}-link-fehler` : undefined}
                      onChange={(e) => setField("link", e.target.value)}
                      className={cn(FIELD, "mt-1.5", fieldErrors.link && "ring-2 ring-tone-bad")}
                    />
                    {fieldErrors.link && (
                      <span id={`${item.id}-link-fehler`} className="sr-only">
                        {fieldErrors.link}
                      </span>
                    )}
                  </div>
                )}

                {(item.fields ?? []).map((field) => {
                  const fid = `${item.id}-${field.key}`;
                  const val = typeof answer[field.key] === "string" ? (answer[field.key] as string) : "";
                  const error = fieldErrors[field.key];
                  const common = {
                    id: fid,
                    maxLength: 8000,
                    placeholder: field.placeholder,
                    value: val,
                    "aria-invalid": error ? true : undefined,
                    "aria-describedby": error ? `${fid}-fehler` : undefined,
                  } as const;
                  return (
                    <div key={field.key}>
                      <label htmlFor={fid} className={FIELD_LABEL}>
                        {field.label}
                        {field.optional && <span className="ml-2 text-sm font-normal text-fg-secondary">Optional</span>}
                      </label>
                      {field.type === "textarea" ? (
                        <ScrollHint watch={val} className="mt-1.5">
                          <textarea
                            {...common}
                            rows={4}
                            onChange={(e) => setField(field.key, e.target.value)}
                            className={cn(FIELD, TEXTAREA_HEIGHT)}
                          />
                        </ScrollHint>
                      ) : (
                        <input
                          {...common}
                          type={field.format === "email" ? "email" : "text"}
                          inputMode={field.format === "tel" ? "tel" : field.format === "email" ? "email" : undefined}
                          onChange={(e) => setField(field.key, e.target.value)}
                          className={cn(FIELD, "mt-1.5", error && "ring-2 ring-tone-bad")}
                        />
                      )}
                      {error && (
                        <span id={`${fid}-fehler`} className="sr-only">
                          {error}
                        </span>
                      )}
                    </div>
                  );
                })}

                {item.allowNichtVorhanden && (
                  <Toggle
                    label="Nicht vorhanden, gemeinsam anlegen"
                    checked={entfaellt}
                    disabled={busyWithFiles}
                    onChange={() =>
                      tapToggle(
                        { status: entfaellt ? "offen" : "entfaellt", selfChecked: false, entfaellt: !entfaellt },
                        { nichtVorhanden: !entfaellt, selfChecked: false }
                      )
                    }
                  />
                )}
              </>
            )}
          </div>

          {needsSaveButton(item) && !keineVorhanden && (
            // One "Speichern" at the end of the item, in the same place for
            // every type; greyed out while it runs, the result in the toast.
            <form action={() => save({ selfChecked }, undefined, "Angaben gespeichert")} className="mt-5">
              <PendingSubmit disabled={busyWithFiles} className={cn(CONTROL, "px-4")}>
                Speichern
              </PendingSubmit>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------
// Bits
// ---------------------------------------------------------------

/** Items with fields the Praxis types into and then saves. */
function needsSaveButton(item: ChecklistItem): boolean {
  if (item.deliveryType === "angabe") return true;
  if (itemAcceptsLink(item.deliveryType)) return true;
  // einladung with extra angabe fields (C1).
  return item.deliveryType === "einladung" && (item.fields?.length ?? 0) > 0;
}

/**
 * A toggle of an item (Stripe's Konto-Checkliste): the browser's own box and
 * its label on one line of one control height, as the Fragebogen's options.
 */
function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label className={cn(OPTION_ROW, disabled && "cursor-default opacity-50 hover:bg-transparent")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className={OPTION_INPUT} />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/**
 * A file on its way, in the place and size of a file row (Dateien's file
 * rows and its progress line): the size, the progress, "Abbrechen" at the
 * end until EINS has registered it.
 */
function UploadingRow({ file, onCancel }: { file: InFlight; onCancel: () => void }) {
  const percent = Math.round(file.progress * 100);
  return (
    <li className={cn("flex items-center gap-3 rounded-[var(--r-panel)]", WASH_AREA, FILE_ROW)}>
      <span aria-hidden className="flex h-5 w-4 shrink-0 items-center justify-center self-start text-fg-tertiary">
        <FileTypeIcon name={file.name} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[15px] font-medium leading-5 text-fg-secondary">{file.name}</p>
        <div className="mt-1 flex min-h-5 items-center gap-x-2 text-sm leading-5 text-fg-secondary">
          <span className="tabular-nums">{formatFileSize(file.size)}</span>
          <span
            role="progressbar"
            aria-label={`${file.name} wird hochgeladen`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="elev-inset h-1.5 w-24 overflow-hidden rounded-[var(--r-small)] bg-[var(--surface-inset)]"
          >
            <span
              className={cn("block h-full rounded-[var(--r-small)] transition-[width]", file.done ? "bg-tone-good" : "bg-accent")}
              style={{ width: `${percent}%` }}
            />
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={file.done || file.progress >= 1}
        onClick={onCancel}
        aria-label={`Hochladen von ${file.name} abbrechen`}
        title="Abbrechen"
        className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "shrink-0 text-fg-secondary")}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Removes one file with one tap, no question first (Dateien's rule). Not
 * ahead of the server: the button greys out, the row goes once EINS has
 * removed it, the toast names the file.
 */
function RemoveFile({
  fileId,
  name,
  onStart,
  onEnd,
}: {
  fileId: string;
  name: string;
  onStart: () => void;
  onEnd: () => void;
}) {
  return (
    <form
      action={async () => {
        onStart();
        try {
          const res = await removeChecklistFile({ fileId });
          if (res.ok) showActionFlash({ tone: "good", title: "Datei entfernt", description: name });
          else showActionFlash({ tone: "bad", title: "Datei nicht entfernt", description: `${name}: Bitte versuchen Sie es erneut.` });
        } catch {
          showActionFlash({
            tone: "bad",
            title: "Datei nicht entfernt",
            description: `${name}: Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.`,
          });
        } finally {
          onEnd();
        }
      }}
    >
      <RemoveSubmit name={name} />
    </form>
  );
}

function RemoveSubmit({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={`Entfernen: ${name}`}
      title="Entfernen"
      className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "text-fg-secondary hover:text-tone-bad disabled:opacity-50")}
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function saveErrorText(code: string): string {
  if (code === "unknown_item") return "Dieser Punkt ist nicht mehr gültig.";
  if (code === "network") {
    return "Speichern hat nicht geklappt, zum Beispiel wegen der Internetverbindung. Ihre Eingaben sind noch da, bitte versuchen Sie es erneut.";
  }
  return "Speichern fehlgeschlagen. Bitte erneut versuchen.";
}

function uploadErrorText(code: string): string {
  switch (code) {
    case "file_too_large":
      return "Datei zu groß (max. 25 MB). Große Sets bitte als Link liefern.";
    case "bad_type":
      return "Dieses Dateiformat passt hier nicht. Bitte das angegebene Format verwenden.";
    case "empty_file":
      return "Die Datei ist leer.";
    case "no_file":
      return "Die Datei ist nicht vollständig angekommen. Bitte laden Sie sie erneut hoch.";
    case "network":
      return "Hochladen hat nicht geklappt, zum Beispiel wegen der Internetverbindung. Bitte versuchen Sie es erneut.";
    default:
      return "Hochladen fehlgeschlagen. Bitte erneut versuchen.";
  }
}
