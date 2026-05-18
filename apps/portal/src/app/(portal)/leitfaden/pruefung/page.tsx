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
          unbegrenzt; nur ein Bestehen wird zur Erfüllung der EINS-Garantie
          gewertet.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-bg-secondary p-4 text-sm text-fg-secondary">
        <strong className="text-fg-primary">Hinweis:</strong> Diese Prüfung ist
        Teil der vertraglichen Mitwirkungspflicht laut EINS-Garantie
        („MFA-Schulung — mindestens ein Praxis-Mitarbeiter absolviert das
        initiale Schulungs-Modul im Portal“). Antworten werden serverseitig
        ausgewertet, jeder Versuch wird im Audit-Log dokumentiert.
        {alreadyPassed && (
          <>
            {" "}
            Sie haben die Prüfung bereits bestanden — ein erneuter Versuch ist
            möglich, ändert aber nichts an Ihrem Pass-Status.
          </>
        )}
      </div>

      <QuizForm />
    </div>
  );
}
