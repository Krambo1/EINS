"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Textarea,
  cn,
} from "@eins/ui";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  Link2,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  CHECKLIST_BLOCKS,
  MAX_CHECKLIST_UPLOAD_BYTES,
  REQUIRED_CHECKLIST_IDS,
  UPLOAD_PROFILES,
  isDelivered,
  itemAcceptsLink,
  itemAcceptsUpload,
  validateChecklistFields,
  type ChecklistAnswer,
  type ChecklistItem,
  type ChecklistStatus,
} from "./content";
import { uploadFileToTarget } from "@/lib/upload-client";
import {
  createChecklistUploadTargetAction,
  finalizeChecklistFileAction,
  removeChecklistFile,
  saveChecklistItem,
} from "./actions";

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
}

export type ClientChecklistState = Record<string, ClientChecklistItemState>;

interface ChecklisteFormProps {
  initialState: ClientChecklistState;
  requiredDelivered: number;
}

export function ChecklisteForm({
  initialState,
  requiredDelivered,
}: ChecklisteFormProps) {
  const total = REQUIRED_CHECKLIST_IDS.length;
  const pct = total > 0 ? Math.round((requiredDelivered / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card className="p-5 md:p-6">
        <CardContent>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-sm text-fg-secondary">Ihr Lieferstand</div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums md:text-3xl">
                {requiredDelivered} / {total} Pflichtpunkte
              </div>
            </div>
            <Badge tone={pct === 100 ? "good" : "accent"}>{pct} %</Badge>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-bg-secondary">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-fg-secondary">
            Sobald Sie einen Punkt geliefert haben, prüfen wir ihn und bestätigen
            ihn mit dem Siegel „Geprüft“. Die fünf Blocker-Punkte (Block A) zählen
            erst als endgültig erledigt, wenn wir sie geprüft haben.
          </p>
        </CardContent>
      </Card>

      {CHECKLIST_BLOCKS.map((block) => (
        <Card
          key={block.key}
          className="border-0 bg-transparent p-0 shadow-none md:border md:bg-bg-primary md:p-6 md:shadow-[var(--shadow-card)]"
        >
          <CardContent className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">
                Block {block.key}: {block.title}
              </h2>
              {block.intro && (
                <p className="mt-1 text-sm text-fg-secondary">{block.intro}</p>
              )}
            </div>
            <div className="space-y-4">
              {block.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  state={
                    initialState[item.id] ?? {
                      status: "offen",
                      answer: {},
                      files: [],
                      verifiedAt: null,
                    }
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// Item card
// ---------------------------------------------------------------

function ItemCard({
  item,
  state,
}: {
  item: ChecklistItem;
  state: ClientChecklistItemState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ChecklistAnswer>(state.answer);
  const fileRef = useRef<HTMLInputElement>(null);

  const delivered = isDelivered(state.status);
  const verified = state.status === "geprueft";
  const entfaellt = state.status === "entfaellt";
  const selfChecked = state.status === "geliefert" || state.status === "geprueft";

  // Inline email/phone validation, mirrored on the server. Blocks save while
  // any contact field holds a malformed value.
  const fieldErrors = validateChecklistFields(item, answer);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  function persist(opts: {
    answer?: ChecklistAnswer;
    selfChecked?: boolean;
    nichtVorhanden?: boolean;
  }) {
    setError(null);
    const toValidate = opts.answer ?? answer;
    const errs = validateChecklistFields(item, toValidate);
    const firstErr = Object.values(errs)[0];
    if (firstErr) {
      setError(firstErr);
      return;
    }
    start(async () => {
      const res = await saveChecklistItem({
        itemId: item.id,
        answer: opts.answer ?? answer,
        selfChecked: opts.selfChecked,
        nichtVorhanden: opts.nichtVorhanden,
      });
      if (!res.ok) {
        setError(saveErrorText(res.error));
        return;
      }
      router.refresh();
    });
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size === 0) {
      setError(uploadErrorText("empty_file"));
      return;
    }
    if (file.size > MAX_CHECKLIST_UPLOAD_BYTES) {
      setError("Datei zu groß (max. 25 MB). Große Sets bitte als Link liefern.");
      return;
    }
    start(async () => {
      // Direct-to-storage: mint a target, upload the bytes straight to
      // object storage, then register the file. The bytes never pass
      // through a server action (serverless request caps).
      const minted = await createChecklistUploadTargetAction({
        itemId: item.id,
        filename: file.name,
        size: file.size,
        contentType: file.type || undefined,
      });
      if (!minted.ok) {
        setError(uploadErrorText(minted.error));
        return;
      }
      try {
        await uploadFileToTarget(minted.target, file);
      } catch {
        setError(uploadErrorText("upload_failed"));
        return;
      }
      const res = await finalizeChecklistFileAction({
        itemId: item.id,
        key: minted.target.key,
        filename: file.name,
        contentType: file.type || undefined,
      });
      if (!res.ok) {
        setError(uploadErrorText(res.error));
        return;
      }
      router.refresh();
    });
  }

  function onRemoveFile(fileId: string) {
    setError(null);
    start(async () => {
      const res = await removeChecklistFile({ fileId });
      if (!res.ok) {
        setError("Datei konnte nicht entfernt werden. Bitte erneut versuchen.");
        return;
      }
      router.refresh();
    });
  }

  function setField(key: string, value: string) {
    setAnswer((prev) => ({ ...prev, [key]: value }));
  }

  const keineVorhanden = answer.keineVorhanden === true;
  const profile = item.uploadProfile ? UPLOAD_PROFILES[item.uploadProfile] : null;

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-colors md:p-4",
        verified
          ? "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)]"
          : delivered
            ? "border-border bg-bg-secondary"
            : "border-border bg-bg-primary"
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <StatusIcon status={state.status} />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-fg-tertiary">
                {item.id}
              </span>
              <span className="font-medium text-fg-primary">{item.title}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {item.required ? (
                <Badge tone="warn">Pflicht</Badge>
              ) : item.recommended ? (
                <Badge>Empfohlen</Badge>
              ) : (
                <Badge>Optional</Badge>
              )}
              {item.blocker && <Badge tone="bad">Blocker</Badge>}
              {item.role === "inhaber" && (
                <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
                  <Lock className="h-3 w-3" /> Inhaber
                </span>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={state.status} required={item.required} />
      </div>

      {/* Anleitung */}
      <div className="mt-3 md:pl-9">
        <Anleitung item={item} />
        {item.warum && (
          <p className="mt-2 text-sm text-fg-secondary">
            <span className="font-medium">Warum:</span> {item.warum}
          </p>
        )}

        {/* Controls */}
        <div className="mt-3 space-y-3">
          {verified && (
            <p className="inline-flex items-center gap-1.5 text-sm text-tone-good">
              <ShieldCheck className="h-4 w-4" />
              Von EINS geprüft und bestätigt.
            </p>
          )}

          {/* "Keine vorhanden" toggle (F2) */}
          {item.allowKeineVorhanden && (
            <ToggleRow
              checked={keineVorhanden}
              disabled={pending}
              label="Keine vorhanden"
              onToggle={() => {
                const next = { ...answer, keineVorhanden: !keineVorhanden };
                setAnswer(next);
                persist({ answer: next });
              }}
            />
          )}

          {!keineVorhanden && (
            <>
              {/* Self-check for status / einladung */}
              {(item.deliveryType === "status" ||
                item.deliveryType === "einladung") && (
                <ToggleRow
                  checked={selfChecked}
                  disabled={pending || entfaellt}
                  label={
                    item.deliveryType === "einladung"
                      ? "Einladung verschickt"
                      : "Erledigt"
                  }
                  onToggle={() => persist({ selfChecked: !selfChecked })}
                />
              )}

              {/* Uploads */}
              {itemAcceptsUpload(item.deliveryType) && (
                <div className="space-y-2">
                  {state.files.length > 0 && (
                    <ul className="space-y-1.5">
                      {state.files.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm"
                        >
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-w-0 items-center gap-2 text-fg-primary hover:text-accent"
                          >
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="truncate">{f.name}</span>
                            <span className="shrink-0 text-fg-tertiary">
                              {formatBytes(f.sizeBytes)}
                            </span>
                          </a>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => onRemoveFile(f.id)}
                            className="shrink-0 text-fg-tertiary hover:text-tone-bad disabled:opacity-50"
                            aria-label="Datei entfernen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={profile?.accept}
                    className="sr-only"
                    onChange={onFilePicked}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    {state.files.length > 0 ? "Weitere Datei" : "Datei hochladen"}
                  </Button>
                  {profile && (
                    <p className="text-xs text-fg-tertiary">
                      {profile.hint}, max. 25 MB pro Datei.
                    </p>
                  )}
                </div>
              )}

              {/* Link */}
              {itemAcceptsLink(item.deliveryType) && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${item.id}-link`} className="text-sm">
                    {itemAcceptsUpload(item.deliveryType)
                      ? "Oder Freigabe-Link (für große Sets)"
                      : "Freigabe-Link"}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 shrink-0 text-fg-tertiary" />
                    <Input
                      id={`${item.id}-link`}
                      type="url"
                      inputMode="url"
                      placeholder="https://drive.google.com/…"
                      value={typeof answer.link === "string" ? answer.link : ""}
                      onChange={(e) => setField("link", e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Angabe fields */}
              {item.fields && item.fields.length > 0 && (
                <div className="space-y-3">
                  {item.fields.map((field) => {
                    const fid = `${item.id}-${field.key}`;
                    const val =
                      typeof answer[field.key] === "string"
                        ? (answer[field.key] as string)
                        : "";
                    const fieldError = fieldErrors[field.key];
                    return (
                      <div key={field.key} className="space-y-1">
                        <Label htmlFor={fid} className="text-sm">
                          {field.label}
                          {field.optional && (
                            <span className="ml-1 text-xs text-fg-tertiary">
                              optional
                            </span>
                          )}
                        </Label>
                        {field.type === "textarea" ? (
                          <Textarea
                            id={fid}
                            rows={3}
                            maxLength={8000}
                            placeholder={field.placeholder}
                            value={val}
                            onChange={(e) => setField(field.key, e.target.value)}
                          />
                        ) : (
                          <Input
                            id={fid}
                            type={field.format === "email" ? "email" : "text"}
                            inputMode={
                              field.format === "tel"
                                ? "tel"
                                : field.format === "email"
                                  ? "email"
                                  : undefined
                            }
                            aria-invalid={fieldError ? true : undefined}
                            maxLength={8000}
                            placeholder={field.placeholder}
                            value={val}
                            onChange={(e) => setField(field.key, e.target.value)}
                          />
                        )}
                        {fieldError && (
                          <p className="flex items-start gap-1.5 text-sm text-tone-bad">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            {fieldError}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* "Nicht vorhanden" for einladung items */}
              {item.allowNichtVorhanden && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    persist({ nichtVorhanden: !entfaellt, selfChecked: false })
                  }
                  className="text-sm text-fg-secondary underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {entfaellt
                    ? "Doch vorhanden? Auswahl zurücknehmen"
                    : "Nicht vorhanden, gemeinsam anlegen"}
                </button>
              )}
            </>
          )}

          {/* Save button for editable text inputs */}
          {needsSaveButton(item) && !keineVorhanden && (
            <div>
              <Button
                type="button"
                size="sm"
                disabled={pending || hasFieldErrors}
                onClick={() => persist({ selfChecked })}
              >
                <Check className="h-4 w-4" />
                {pending ? "Wird gespeichert …" : "Angaben speichern"}
              </Button>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-tone-bad">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Bits
// ---------------------------------------------------------------

/** Items that have free-text inputs the user types into and then saves. */
function needsSaveButton(item: ChecklistItem): boolean {
  if (item.deliveryType === "angabe") return true;
  if (itemAcceptsLink(item.deliveryType)) return true;
  // einladung with extra angabe fields (e.g. C1).
  if (item.deliveryType === "einladung" && (item.fields?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

function Anleitung({ item }: { item: ChecklistItem }) {
  // The einladung steps are long; keep them collapsed so the page stays
  // scannable. Everything else is short enough to show inline.
  if (item.deliveryType === "einladung") {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-accent">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          Schritt-für-Schritt-Anleitung
        </summary>
        <p className="mt-2 whitespace-pre-line text-sm text-fg-secondary">
          {item.anleitung}
        </p>
      </details>
    );
  }
  return (
    <p className="whitespace-pre-line text-sm text-fg-secondary">
      {item.anleitung}
    </p>
  );
}

function ToggleRow({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50",
        checked
          ? "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] text-tone-good"
          : "border-border bg-bg-primary text-fg-primary hover:border-fg-secondary"
      )}
    >
      {checked ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <Circle className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}

function StatusIcon({ status }: { status: ChecklistStatus }) {
  if (status === "geprueft") {
    return (
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-tone-good" />
    );
  }
  if (status === "geliefert") {
    return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />;
  }
  if (status === "entfaellt") {
    return <Circle className="mt-0.5 h-5 w-5 shrink-0 text-fg-tertiary" />;
  }
  return <Circle className="mt-0.5 h-5 w-5 shrink-0 text-fg-tertiary" />;
}

function StatusBadge({
  status,
  required,
}: {
  status: ChecklistStatus;
  required: boolean;
}) {
  if (status === "geprueft") return <Badge tone="good">Geprüft</Badge>;
  if (status === "geliefert") return <Badge tone="accent">Geliefert</Badge>;
  if (status === "entfaellt") return <Badge>Entfällt</Badge>;
  if (required) return <Badge tone="warn">Offen</Badge>;
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function saveErrorText(code: string): string {
  if (code === "unknown_item") return "Dieser Punkt ist nicht mehr gültig.";
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
      return "Keine Datei ausgewählt.";
    default:
      return "Hochladen fehlgeschlagen. Bitte erneut versuchen.";
  }
}
