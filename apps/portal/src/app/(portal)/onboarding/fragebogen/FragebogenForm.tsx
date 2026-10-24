"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, Input, Label, Textarea, cn } from "@eins/ui";
import { AlertCircle, Check, CheckCircle2, Save } from "lucide-react";
import {
  DISCOVERY_BLOCKS,
  formatBudgetEur,
  isAnswered,
  parseEuroAmount,
  type DiscoveryAnswers,
  type DiscoveryQuestion,
} from "./content";
import { saveDiscoveryAction, type SaveDiscoveryState } from "./actions";
import { SectionNav, type SectionNavItem } from "./SectionNav";

const sectionAnchorId = (key: string) => `abschnitt-${key}`;

interface FragebogenFormProps {
  initialAnswers: DiscoveryAnswers;
  /** True when a draft row already exists (changes the save-button copy). */
  hasDraft: boolean;
  /** `updatedAt` (ISO) of the loaded row, null when none; sent for the stale-tab check. */
  baseUpdatedAt: string | null;
  /** localStorage key for the on-device backup of unsaved answers (per clinic). */
  storageKey: string;
}

/** On-device backup of answers that are not yet saved on the server. */
interface LocalBackup {
  answers: DiscoveryAnswers;
  /** Server version the answers were typed against. */
  base: string | null;
  savedAt: number;
}

function readBackup(key: string): LocalBackup | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalBackup;
    if (!parsed || typeof parsed !== "object" || !parsed.answers || typeof parsed.answers !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeBackup(key: string, backup: LocalBackup | null) {
  try {
    if (backup) window.localStorage.setItem(key, JSON.stringify(backup));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode / quota: the server draft is still the source of truth.
  }
}

/**
 * Teil-1 form. All answers live in one local state map keyed by question id;
 * "Zwischenspeichern" persists a draft, "Antworten einreichen" runs the
 * Pflichtfragen check server-side and freezes the row. Missing required
 * questions returned by the server get highlighted inline.
 */
export function FragebogenForm({
  initialAnswers,
  hasDraft,
  baseUpdatedAt,
  storageKey,
}: FragebogenFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<DiscoveryAnswers>(initialAnswers);
  const [state, setState] = useState<SaveDiscoveryState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  // Server version this form is based on; advances after each own save.
  const [base, setBase] = useState<string | null>(baseUpdatedAt);
  // Unsaved answers from an earlier visit whose server version moved on.
  const [staleBackup, setStaleBackup] = useState<LocalBackup | null>(null);
  const [restored, setRestored] = useState(false);
  const dirty = useRef(false);
  const submitting = useRef(false);

  // Restore unsaved answers from this device (session expired, network lost,
  // tab closed). Same server version: restore directly; otherwise ask.
  useEffect(() => {
    const backup = readBackup(storageKey);
    if (!backup) return;
    if (backup.base === baseUpdatedAt) {
      dirty.current = true;
      setAnswers(backup.answers);
      setRestored(true);
    } else {
      setStaleBackup(backup);
    }
    // Mount only: later prop changes come from our own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror unsaved answers to localStorage (debounced).
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => {
      writeBackup(storageKey, { answers, base, savedAt: Date.now() });
    }, 500);
    return () => window.clearTimeout(t);
  }, [answers, base, storageKey]);

  const missingIds = useMemo(
    () => new Set(state.kind === "error" ? state.missingIds ?? [] : []),
    [state]
  );

  const setAnswer = (id: string, value: string | string[]) => {
    dirty.current = true;
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const persist = (submit: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    // Back up synchronously before the request, so a redirect to the login
    // page (expired session) never loses what was typed.
    writeBackup(storageKey, { answers, base, savedAt: Date.now() });
    startTransition(async () => {
      try {
        const result = await saveDiscoveryAction({
          answers,
          submit,
          baseUpdatedAt: base,
        });
        setState(result);
        if (result.kind === "saved" || result.kind === "submitted") {
          dirty.current = false;
          setBase(result.updatedAt);
          setRestored(false);
          writeBackup(storageKey, null);
        }
        if (result.kind === "submitted") {
          // Server state changed to read-only; re-render the page recap.
          router.refresh();
        }
      } catch {
        setState({
          kind: "error",
          message:
            "Speichern hat nicht geklappt, zum Beispiel wegen der Internetverbindung. Ihre Eingaben sind noch da und auf diesem Gerät gesichert. Bitte versuchen Sie es gleich noch einmal.",
        });
      } finally {
        submitting.current = false;
      }
    });
  };

  const adoptStaleBackup = () => {
    if (!staleBackup) return;
    dirty.current = true;
    setAnswers(staleBackup.answers);
    setStaleBackup(null);
    setRestored(true);
  };
  const discardStaleBackup = () => {
    setStaleBackup(null);
    writeBackup(storageKey, null);
  };

  const answeredRequired = DISCOVERY_BLOCKS.flatMap((b) => b.questions).filter(
    (q) => q.required && isAnswered(answers[q.id])
  ).length;
  const totalRequired = DISCOVERY_BLOCKS.flatMap((b) => b.questions).filter(
    (q) => q.required
  ).length;

  // Section navigation: completion per block, derived from the form state.
  const sectionItems: SectionNavItem[] = DISCOVERY_BLOCKS.map((block) => {
    const required = block.questions.filter((q) => q.required);
    const answered = required.filter((q) => isAnswered(answers[q.id])).length;
    return {
      key: block.key,
      anchorId: sectionAnchorId(block.key),
      title: block.title,
      answeredRequired: answered,
      totalRequired: required.length,
      complete:
        required.length > 0
          ? answered === required.length
          : block.questions.some((q) => isAnswered(answers[q.id])),
    };
  });

  // Which section is in view (for "Abschnitt X von Y").
  const [activeKey, setActiveKey] = useState<string>(DISCOVERY_BLOCKS[0]?.key ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const order = DISCOVERY_BLOCKS.map((b) => b.key);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.sectionKey;
          if (!key) continue;
          if (entry.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        const first = order.find((k) => visible.has(k));
        if (first) setActiveKey(first);
      },
      // A band in the upper part of the screen, below the sticky bars.
      { rootMargin: "-160px 0px -50% 0px" }
    );
    for (const key of order) {
      const el = document.getElementById(sectionAnchorId(key));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start xl:gap-8">
    <SectionNav items={sectionItems} activeKey={activeKey} onJump={setActiveKey} />
    <div className="space-y-6">
      {staleBackup && (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-bg-secondary p-3 text-sm text-fg-primary">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            Auf diesem Gerät liegen noch nicht gespeicherte Antworten vom{" "}
            {new Date(staleBackup.savedAt).toLocaleString("de-DE", {
              timeZone: "Europe/Berlin",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            Uhr. Der Fragebogen wurde seitdem an anderer Stelle gespeichert.
            Möchten Sie die Antworten von diesem Gerät übernehmen?
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={adoptStaleBackup}>
              Übernehmen
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={discardStaleBackup}>
              Verwerfen
            </Button>
          </div>
        </div>
      )}

      {restored && state.kind === "idle" && (
        <div className="flex items-start gap-3 rounded-md border border-border bg-bg-secondary p-3 text-sm text-fg-primary">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Wir haben Ihre noch nicht gespeicherten Antworten auf diesem Gerät
            wiederhergestellt. Bitte speichern Sie sie.
          </span>
        </div>
      )}

      {DISCOVERY_BLOCKS.map((block) => (
        <Card
          key={block.key}
          id={sectionAnchorId(block.key)}
          data-section-key={block.key}
          className="scroll-mt-40 p-5 md:p-6 xl:scroll-mt-24"
        >
          <CardContent>
            <div className="mb-2">
              <h2 className="text-lg font-semibold">{block.title}</h2>
              {block.why && (
                <p className="mt-1 text-sm text-fg-secondary">
                  Warum wir fragen: {block.why}
                </p>
              )}
            </div>
            <div className="divide-y divide-border">
              {block.questions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={answers[q.id]}
                  missing={missingIds.has(q.id)}
                  onChange={(v) => setAnswer(q.id, v)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {state.kind === "error" && (
        <div className="flex items-start gap-3 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      {state.kind === "saved" && (
        <div className="flex items-start gap-3 rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] p-3 text-sm text-tone-good">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Zwischengespeichert. Sie können jederzeit weitermachen, auch von
            einem anderen Gerät.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm font-medium text-fg-primary">
          {answeredRequired} von {totalRequired} Pflichtfragen beantwortet.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => persist(false)}
          >
            <Save className="h-4 w-4" />
            {pending
              ? "Wird gespeichert …"
              : hasDraft
                ? "Zwischenspeichern"
                : "Entwurf speichern"}
          </Button>
          <Button type="button" disabled={pending} onClick={() => persist(true)}>
            <Check className="h-4 w-4" />
            Antworten einreichen
          </Button>
        </div>
      </div>
      <p className="text-sm text-fg-secondary">
        Nach dem Einreichen können Sie Ihre Antworten weiterhin anpassen. Ihr
        EINS-Team wird über Änderungen automatisch informiert, damit Ihr KI-Klon,
        Ihre Beiträge und Ihre Zielseite auf dem aktuellen Stand aufbauen.
      </p>
    </div>
    </div>
  );
}

interface QuestionFieldProps {
  question: DiscoveryQuestion;
  value: string | string[] | undefined;
  missing: boolean;
  onChange: (value: string | string[]) => void;
}

function QuestionField({ question: q, value, missing, onChange }: QuestionFieldProps) {
  const inputId = `discovery-${q.id}`;
  return (
    <div className="py-4 first:pt-0 last:pb-0 md:py-5">
      <div
        className={cn(
          "space-y-2 rounded-lg",
          missing &&
            "border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3"
        )}
      >
      <Label htmlFor={inputId} className="flex flex-wrap items-baseline gap-x-2">
        <span>{q.label}</span>
        {q.required ? (
          <span className="text-sm font-medium text-fg-primary">Pflichtfrage</span>
        ) : (
          <span className="text-sm font-medium text-fg-primary">Optional</span>
        )}
      </Label>
      {q.hint && <p className="text-sm text-fg-secondary">{q.hint}</p>}

      {q.type === "text" && (
        <Input
          id={inputId}
          type="text"
          maxLength={4000}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {q.type === "textarea" && (
        <Textarea
          id={inputId}
          rows={4}
          maxLength={4000}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {q.type === "auswahl" && q.options && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.label}>
            {q.options.map((opt) => {
              const selected = value === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange(selected ? "" : opt)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                    selected
                      ? "border-fg-primary bg-fg-primary font-semibold text-bg-primary"
                      : "border-border bg-bg-secondary font-medium text-fg-primary hover:border-fg-secondary"
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {q.allowCustom && (
            <CustomBudgetField
              question={q}
              inputId={inputId}
              isPreset={
                typeof value === "string" && (q.options?.includes(value) ?? false)
              }
              value={typeof value === "string" ? value : ""}
              onChange={onChange}
            />
          )}
        </div>
      )}

      {q.type === "mehrfach" && q.options && (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={inputId}>
          {q.options.map((opt) => {
            const current = Array.isArray(value) ? value : [];
            const selected = current.includes(opt);
            const atCap =
              !selected && q.maxSelect != null && current.length >= q.maxSelect;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={selected}
                disabled={atCap}
                onClick={() =>
                  onChange(
                    selected
                      ? current.filter((v) => v !== opt)
                      : [...current, opt]
                  )
                }
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  selected
                    ? "border-fg-primary bg-fg-primary font-semibold text-bg-primary"
                    : "border-border bg-bg-secondary font-medium text-fg-primary hover:border-fg-secondary",
                  atCap && "cursor-not-allowed opacity-50 hover:border-border"
                )}
              >
                {opt}
              </button>
            );
          })}
          {q.maxSelect != null && (
            <span className="self-center text-sm font-medium text-fg-primary">
              Höchstens {q.maxSelect}
            </span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

interface CustomBudgetFieldProps {
  question: DiscoveryQuestion;
  inputId: string;
  /** True when the current answer is one of the preset pills (custom is then empty). */
  isPreset: boolean;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Free-entry budget field next to the preset pills. Typing here replaces the
 * answer (which deselects the pills, since the value no longer matches an
 * option). Shows a live note: an error for a non-numeric value, otherwise a
 * confirmation of the parsed amount. There is no minimum amount.
 */
function CustomBudgetField({
  question: q,
  inputId,
  isPreset,
  value,
  onChange,
}: CustomBudgetFieldProps) {
  const raw = isPreset ? "" : value;
  const note = budgetNoteFor(raw);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg-primary">
          {q.customLabel ?? "Oder eigener Betrag"}:
        </span>
        <Input
          id={`${inputId}-custom`}
          type="text"
          inputMode="numeric"
          maxLength={12}
          placeholder="z. B. 2.000"
          value={raw}
          onChange={(e) => onChange(e.target.value)}
          aria-label={q.customLabel ?? "Eigener Betrag pro Monat"}
          className="max-w-[10rem]"
        />
        <span className="text-sm text-fg-secondary">€ pro Monat</span>
      </div>
      {note && (
        <p
          className={cn(
            "text-sm",
            note.tone === "bad" ? "text-tone-bad" : "text-fg-secondary"
          )}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/** Live message for the custom budget input; null when the field is empty. */
function budgetNoteFor(
  raw: string
): { tone: "bad" | "muted"; text: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const eur = parseEuroAmount(trimmed);
  if (eur === null) {
    return {
      tone: "bad",
      text: "Bitte einen Betrag eingeben, zum Beispiel 2.000. Für eine Spanne wählen Sie oben eine Stufe.",
    };
  }
  return { tone: "muted", text: `Geplant: ${formatBudgetEur(eur)} pro Monat.` };
}
