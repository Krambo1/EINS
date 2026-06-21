"use client";

import { useMemo, useState, useTransition } from "react";
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

interface FragebogenFormProps {
  initialAnswers: DiscoveryAnswers;
  /** True when a draft row already exists (changes the save-button copy). */
  hasDraft: boolean;
}

/**
 * Teil-1 form. All answers live in one local state map keyed by question id;
 * "Zwischenspeichern" persists a draft, "Antworten einreichen" runs the
 * Pflichtfragen check server-side and freezes the row. Missing required
 * questions returned by the server get highlighted inline.
 */
export function FragebogenForm({ initialAnswers, hasDraft }: FragebogenFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<DiscoveryAnswers>(initialAnswers);
  const [state, setState] = useState<SaveDiscoveryState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const missingIds = useMemo(
    () => new Set(state.kind === "error" ? state.missingIds ?? [] : []),
    [state]
  );

  const setAnswer = (id: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const persist = (submit: boolean) => {
    startTransition(async () => {
      const result = await saveDiscoveryAction({ answers, submit });
      setState(result);
      if (result.kind === "submitted") {
        // Server state changed to read-only; re-render the page recap.
        router.refresh();
      }
    });
  };

  const answeredRequired = DISCOVERY_BLOCKS.flatMap((b) => b.questions).filter(
    (q) => q.required && isAnswered(answers[q.id])
  ).length;
  const totalRequired = DISCOVERY_BLOCKS.flatMap((b) => b.questions).filter(
    (q) => q.required
  ).length;

  return (
    <div className="space-y-6">
      {DISCOVERY_BLOCKS.map((block) => (
        <Card key={block.key} className="p-5 md:p-6">
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
        <p className="text-sm text-fg-secondary">
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
      <p className="text-xs text-fg-secondary">
        Nach dem Einreichen können Sie Ihre Antworten weiterhin anpassen. Ihr
        EINS-Team wird über Änderungen automatisch informiert, damit Kampagnen
        und Strategie auf dem aktuellen Stand aufbauen.
      </p>
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
          <span className="text-xs font-medium text-fg-tertiary">Pflicht</span>
        ) : (
          <span className="text-xs font-medium text-fg-tertiary">optional</span>
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
            <span className="self-center text-xs text-fg-tertiary">
              max. {q.maxSelect}
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
 * option). Shows a live note: below the hard floor it's a blocking-style
 * error, between floor and recommendation a soft hint, above it a confirmation
 * of the parsed amount.
 */
function CustomBudgetField({
  question: q,
  inputId,
  isPreset,
  value,
  onChange,
}: CustomBudgetFieldProps) {
  const raw = isPreset ? "" : value;
  const note = budgetNoteFor(q, raw);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg-secondary">
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
  q: DiscoveryQuestion,
  raw: string
): { tone: "bad" | "muted"; text: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const eur = parseEuroAmount(trimmed);
  if (eur === null) {
    return { tone: "bad", text: "Bitte als Zahl eingeben, zum Beispiel 2.000." };
  }
  const min = q.customMinEur ?? 0;
  if (eur < min) {
    return {
      tone: "bad",
      text: `Unter ${formatBudgetEur(
        min
      )} pro Monat lässt sich keine wirksame Kampagne aufsetzen.`,
    };
  }
  if (q.recommendedMinEur && eur < q.recommendedMinEur) {
    return {
      tone: "muted",
      text: `${formatBudgetEur(
        eur
      )} pro Monat liegt unter unserer Empfehlung von ${formatBudgetEur(
        q.recommendedMinEur
      )}. Die Werbung braucht etwas Volumen, um zu lernen. Wir besprechen das gern.`,
    };
  }
  return { tone: "muted", text: `Geplant: ${formatBudgetEur(eur)} pro Monat.` };
}
