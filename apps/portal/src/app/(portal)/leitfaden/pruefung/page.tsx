import Link from "next/link";
import { Badge } from "@eins/ui";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { hasUserPassedLeitfadenQuiz } from "@/server/queries/leitfaden";
import { PASS_THRESHOLD, TOTAL_QUESTIONS } from "./questions";
import { QuizForm } from "./QuizForm";

export const metadata = { title: "Leitfaden-Prüfung" };

export default async function LeitfadenPruefungPage() {
  const session = await requirePermissionOrRedirect("leitfaden.quiz");
  const alreadyPassed = await hasUserPassedLeitfadenQuiz(
    session.clinicId,
    session.userId
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/leitfaden"
        className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zum Leitfaden
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold md:text-4xl">
            Leitfaden-Prüfung.
          </h1>
          {alreadyPassed && (
            <Badge tone="good">
              <ShieldCheck className="h-3.5 w-3.5" />
              Bereits bestanden
            </Badge>
          )}
        </div>
        <p className="text-base text-fg-primary md:text-lg">
          {TOTAL_QUESTIONS} Fragen aus dem Vertriebsleitfaden. Zum Bestehen
          benötigen Sie {PASS_THRESHOLD} richtige Antworten. Versuche sind
          unbegrenzt.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-bg-secondary p-4 text-sm text-fg-secondary">
        <strong className="text-fg-primary">Hinweis:</strong> Diese Prüfung ist
        eine Schulung für Ihr Praxisteam. Wir empfehlen, dass mindestens eine
        Person pro Praxis besteht. Eine Bedingung für Ihre Zusammenarbeit mit
        EINS ist das nicht. Antworten werden serverseitig ausgewertet, jeder
        Versuch wird im Protokoll festgehalten.
        {alreadyPassed && (
          <>
            {" "}
            Sie haben die Prüfung bereits bestanden. Ein erneuter Versuch ist
            möglich, ändert aber nichts daran, dass Sie bestanden haben.
          </>
        )}
      </div>

      <QuizForm />
    </div>
  );
}
