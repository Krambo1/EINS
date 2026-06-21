import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@eins/ui";
import { ClipboardList } from "lucide-react";
import {
  DISCOVERY_BLOCKS,
  isAnswered,
  type DiscoveryAnswers,
} from "@/app/(portal)/onboarding/fragebogen/content";

const GLOW_CARD = "!bg-bg-secondary";

export interface FragebogenTabData {
  status: "entwurf" | "eingereicht";
  answers: DiscoveryAnswers;
  submittedAt: Date | null;
  /** Set when the Praxis edited + re-submitted after its first submission. */
  resubmittedAt: Date | null;
  submittedByName: string | null;
  updatedAt: Date;
}

/**
 * Read-only admin view of the clinic's Discovery-Fragebogen (Teil 1).
 * Pure render: the page fetches the row; no editing, no reopen in v1
 * (reopen = manual SQL until there's a real need).
 */
export function FragebogenTab({ data }: { data: FragebogenTabData | null }) {
  if (!data) {
    return (
      <Card className={GLOW_CARD}>
        <CardContent className="py-10">
          <EmptyState
            icon={<ClipboardList className="h-8 w-8" />}
            title="Noch keine Antworten"
            description="Die Praxis hat den Discovery-Fragebogen noch nicht begonnen. Er ist Schritt 1 unter „Erste Schritte“ im Kundenportal."
          />
        </CardContent>
      </Card>
    );
  }

  const allQuestions = DISCOVERY_BLOCKS.flatMap((b) => b.questions);
  const answeredCount = allQuestions.filter((q) =>
    isAnswered(data.answers[q.id])
  ).length;
  const requiredOpen = allQuestions.filter(
    (q) => q.required && !isAnswered(data.answers[q.id])
  ).length;
  const submitted = data.status === "eingereicht";

  return (
    <div className="space-y-6">
      <Card className={GLOW_CARD}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            {submitted ? (
              <Badge tone="good">Eingereicht</Badge>
            ) : (
              <Badge tone="warn">Entwurf</Badge>
            )}
            {data.resubmittedAt && (
              <Badge tone="accent">Erneut eingereicht</Badge>
            )}
            <span className="text-sm text-fg-primary">
              {answeredCount} von {allQuestions.length} Fragen beantwortet
              {!submitted && requiredOpen > 0 && (
                <span className="text-fg-secondary">
                  {" "}
                  ({requiredOpen} Pflichtfragen offen)
                </span>
              )}
            </span>
          </div>
          <div className="text-right text-sm text-fg-secondary">
            {submitted && data.submittedAt ? (
              <>
                Eingereicht am{" "}
                {data.submittedAt.toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
                {data.submittedByName ? ` von ${data.submittedByName}` : null}
              </>
            ) : (
              <>
                Zuletzt bearbeitet am{" "}
                {data.updatedAt.toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </>
            )}
            {data.resubmittedAt && (
              <div className="font-medium text-accent">
                Von der Praxis angepasst am{" "}
                {data.resubmittedAt.toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {DISCOVERY_BLOCKS.map((block) => (
        <Card key={block.key} className={GLOW_CARD}>
          <CardHeader>
            <CardTitle>{block.title}</CardTitle>
            {block.why && <CardDescription>{block.why}</CardDescription>}
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              {block.questions.map((q) => {
                const value = data.answers[q.id];
                const text = Array.isArray(value) ? value.join(", ") : value;
                const answered = isAnswered(value);
                return (
                  <div key={q.id}>
                    <dt className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-fg-secondary">
                      <span className="font-mono text-xs text-fg-tertiary">
                        {q.id}
                      </span>
                      <span>{q.label}</span>
                      {q.required && !answered && (
                        <span className="text-xs text-tone-warn">
                          Pflicht, offen
                        </span>
                      )}
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-base text-fg-primary">
                      {answered ? (
                        text
                      ) : (
                        <span className="text-fg-tertiary">Keine Angabe</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
