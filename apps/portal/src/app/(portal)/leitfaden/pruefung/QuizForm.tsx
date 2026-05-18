"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn } from "@eins/ui";
import { CheckCircle2, AlertCircle, RotateCcw, ListChecks } from "lucide-react";
import {
  PASS_THRESHOLD,
  PUBLIC_QUESTIONS,
  TOTAL_QUESTIONS,
  sourceHintFor,
} from "./questions";
import { submitQuizAttemptAction, type SubmitQuizState } from "./actions";

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      <ListChecks className="h-4 w-4" />
      {pending ? "Wird ausgewertet …" : "Antworten abgeben"}
    </Button>
  );
}

export function QuizForm() {
  const [state, formAction] = useActionState<
    SubmitQuizState | undefined,
    FormData
  >(submitQuizAttemptAction, { kind: "idle" });

  // Track the user's local selections so we can (a) enable the submit button
  // only when all questions are answered, and (b) show "diese Frage war
  // falsch" on the right item after submit without re-querying the form.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const submitted = state?.kind === "submitted" ? state : null;

  // Scroll the result banner into view after a submit so the user immediately
  // sees their score instead of staring at the last question.
  useEffect(() => {
    if (!submitted) return;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [submitted]);

  const allAnswered = useMemo(() => {
    return PUBLIC_QUESTIONS.every((q) => Boolean(selections[q.id]));
  }, [selections]);

  // Build a lookup of question-id → correctness from the server result so we
  // can decorate each question card without exposing the correct option id.
  const resultByQuestion = useMemo(() => {
    if (!submitted) return null;
    const map = new Map<string, boolean>();
    for (const r of submitted.results) {
      map.set(r.questionId, r.correct);
    }
    return map;
  }, [submitted]);

  const onRetake = () => {
    // Clear selections + form state so the user can start the next attempt
    // fresh. The Server Action state isn't directly clearable; we instead
    // navigate back to the same page to discard it.
    setSelections({});
    formRef.current?.reset();
    // Force re-mount of the action state by reloading the page (cheap and
    // matches the user's mental model of "starting over").
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-6"
      aria-describedby="quiz-intro"
    >
      <p id="quiz-intro" className="text-sm text-fg-secondary">
        {submitted
          ? "Ergebnis siehe unten. Beim nächsten Versuch starten Sie mit einem leeren Bogen."
          : `Beantworten Sie alle ${TOTAL_QUESTIONS} Fragen, um die Prüfung abzuschließen. Sie müssen ${PASS_THRESHOLD} von ${TOTAL_QUESTIONS} richtig beantworten.`}
      </p>

      <ol className="space-y-6">
        {PUBLIC_QUESTIONS.map((q, idx) => {
          const verdict = resultByQuestion?.get(q.id);
          const wasWrong = verdict === false;
          return (
            <li
              key={q.id}
              className={cn(
                "rounded-2xl border bg-bg-primary p-5",
                wasWrong
                  ? "border-[var(--tone-bad-border)]"
                  : verdict === true
                  ? "border-[var(--tone-good-border)]"
                  : "border-border"
              )}
            >
              <fieldset disabled={submitted !== null}>
                <legend className="mb-4 text-base font-semibold text-fg-primary">
                  <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-bg-secondary px-2 text-xs font-medium text-fg-secondary">
                    {idx + 1}
                  </span>
                  {q.prompt}
                </legend>
                <div className="space-y-2">
                  {q.options.map((opt) => {
                    const inputId = `q-${q.id}-${opt.id}`;
                    const checked = selections[q.id] === opt.id;
                    return (
                      <label
                        key={opt.id}
                        htmlFor={inputId}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-primary px-3 py-2.5 text-sm transition-colors hover:bg-bg-secondary",
                          checked && "border-fg-primary bg-bg-secondary",
                          submitted !== null && "cursor-default hover:bg-bg-primary"
                        )}
                      >
                        <input
                          id={inputId}
                          type="radio"
                          name={`q:${q.id}`}
                          value={opt.id}
                          required
                          checked={checked}
                          onChange={(e) =>
                            setSelections((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-fg-primary"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
                {wasWrong && (
                  <p className="mt-3 flex items-start gap-2 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Diese Antwort ist nicht richtig.
                      {sourceHintFor(q.id) && (
                        <>
                          {" "}
                          Schauen Sie hier nochmal nach:{" "}
                          <strong>{sourceHintFor(q.id)}</strong>
                        </>
                      )}
                    </span>
                  </p>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div ref={resultRef}>
        {state?.kind === "error" && (
          <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-4 text-sm text-tone-bad">
            {state.message}
          </div>
        )}

        {submitted && submitted.passed && (
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] p-5 text-tone-good">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
            <div className="space-y-1">
              <p className="text-lg font-semibold">
                Bestanden mit {submitted.score} von {submitted.total} Punkten.
              </p>
              <p className="text-sm">
                Glückwunsch — Sie haben die Leitfaden-Prüfung abgeschlossen. Der
                Hinweis-Punkt neben „Leitfaden“ in der Navigation verschwindet
                beim nächsten Page-Refresh.
              </p>
            </div>
          </div>
        )}

        {submitted && !submitted.passed && (
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-5 text-tone-bad">
            <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" />
            <div className="space-y-2">
              <p className="text-lg font-semibold">
                {submitted.score} von {submitted.total} richtig — leider noch
                nicht bestanden.
              </p>
              <p className="text-sm">
                Zum Bestehen benötigen Sie {PASS_THRESHOLD} von{" "}
                {submitted.total} richtig (Ihnen fehlen noch{" "}
                {Math.max(PASS_THRESHOLD - submitted.score, 0)}). Die rot
                markierten Fragen oben zeigen, wo Sie nochmal nachlesen sollten.
                Versuche sind unbegrenzt.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-fg-secondary">
          Bestehen: {PASS_THRESHOLD}/{TOTAL_QUESTIONS}. Versuche unbegrenzt.
          Antworten werden serverseitig ausgewertet und im Audit-Log
          gespeichert.
        </p>
        {submitted ? (
          <Button type="button" onClick={onRetake} variant="secondary">
            <RotateCcw className="h-4 w-4" />
            Neuer Versuch
          </Button>
        ) : (
          <SubmitButton disabled={!allAnswered} />
        )}
      </div>
    </form>
  );
}
