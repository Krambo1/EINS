"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from "@eins/ui";
import { AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { checkHwgAction, type CheckHwgState } from "./actions";
import type { HwgFinding } from "@/server/hwg";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Wird geprüft …" : "Jetzt prüfen"}
    </Button>
  );
}

export function HwgForm() {
  const [state, formAction] = useActionState<CheckHwgState | undefined, FormData>(
    checkHwgAction,
    { kind: "idle" }
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-3">
        <label className="block text-sm font-medium">
          Text zum Prüfen (Anzeige, Zielseite, E-Mail …)
        </label>
        <textarea
          name="text"
          rows={8}
          maxLength={5000}
          required
          defaultValue={state?.kind === "result" ? state.input : ""}
          placeholder="Fügen Sie hier den Text ein, den Sie auf HWG-Konformität prüfen möchten."
          className="w-full rounded-xl border border-border bg-bg-primary p-3 text-base"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-fg-secondary">
            Die Prüfung ist eine automatische Vorab-Einschätzung, kein
            Rechtsrat. Bei Zweifel ziehen wir vor Veröffentlichung eine
            juristische Freigabe hinzu.
          </p>
          <SubmitButton />
        </div>
      </form>

      {state?.kind === "error" && (
        <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-tone-bad">
          {state.message}
        </div>
      )}

      {state?.kind === "result" && (
        <ResultPanel input={state.input} result={state.result} />
      )}
    </div>
  );
}

function ResultPanel({
  input,
  result,
}: {
  input: string;
  result: { verdict: "clean" | "warn" | "violation"; findings: HwgFinding[] };
}) {
  const { verdict, findings } = result;

  const verdictMeta = {
    clean: {
      icon: <CheckCircle2 className="h-6 w-6" />,
      tone: "good" as const,
      title: "Keine HWG-Treffer gefunden",
      description:
        "Der Text enthält keine der geprüften Risikomuster. Eine abschließende juristische Freigabe ersetzt das nicht.",
    },
    warn: {
      icon: <AlertTriangle className="h-6 w-6" />,
      tone: "warn" as const,
      title: "Graubereich",
      description:
        "Einzelne Formulierungen können je nach Kontext problematisch sein. Bitte Fundstellen prüfen.",
    },
    violation: {
      icon: <AlertCircle className="h-6 w-6" />,
      tone: "bad" as const,
      title: "Klare Verstöße gefunden",
      description:
        "So nicht veröffentlichen. Die markierten Stellen bitte anpassen und erneut prüfen.",
    },
  }[verdict];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 place-items-center rounded-full ${
              verdictMeta.tone === "good"
                ? "bg-[var(--tone-good-bg)] text-tone-good"
                : verdictMeta.tone === "warn"
                ? "bg-[var(--tone-warn-bg)] text-tone-warn"
                : "bg-[var(--tone-bad-bg)] text-tone-bad"
            }`}
          >
            {verdictMeta.icon}
          </span>
          <div>
            <CardTitle>{verdictMeta.title}</CardTitle>
            <p className="mt-1 text-sm text-fg-secondary">
              {verdictMeta.description}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {findings.length === 0 ? null : (
          <>
            {/* Highlighted input */}
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Markierter Text
              </div>
              <p className="whitespace-pre-wrap rounded-xl border border-border bg-bg-secondary/40 p-4 text-base leading-relaxed">
                {renderWithHighlights(input, findings)}
              </p>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Fundstellen ({findings.length})
              </div>
              <ul className="space-y-2">
                {findings.map((f, i) => (
                  <li
                    key={`${f.ruleId}-${i}`}
                    className="flex gap-3 rounded-lg border border-border bg-bg-secondary/30 p-3"
                  >
                    <Badge tone={f.severity === "red" ? "bad" : "warn"}>
                      {f.severity === "red" ? "Rot" : "Gelb"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-fg-primary">
                        „{f.match}“
                      </div>
                      <p className="mt-1 text-sm text-fg-primary">
                        {f.reason}
                      </p>
                      {f.reference && (
                        <p className="mt-1 text-xs text-fg-secondary">
                          {f.reference}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Re-render the input text with severity-coloured highlights around matches. */
function renderWithHighlights(input: string, findings: HwgFinding[]) {
  if (findings.length === 0) return input;
  const sorted = [...findings].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((f, i) => {
    // Skip overlapping findings — simplification, rule set is sparse enough.
    if (f.start < cursor) return;
    if (f.start > cursor) parts.push(input.slice(cursor, f.start));
    parts.push(
      <mark
        key={`${f.ruleId}-${i}`}
        className={`rounded px-0.5 ${
          f.severity === "red"
            ? "bg-[var(--tone-bad-bg)] text-tone-bad"
            : "bg-[var(--tone-warn-bg)] text-tone-warn"
        }`}
      >
        {input.slice(f.start, f.end)}
      </mark>
    );
    cursor = f.end;
  });
  if (cursor < input.length) parts.push(input.slice(cursor));
  return parts;
}
