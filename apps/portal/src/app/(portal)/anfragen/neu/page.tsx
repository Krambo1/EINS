import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listTreatments } from "@/server/queries/treatments";
import { ManualEntryForm } from "./_form";

export const metadata = { title: "Anfrage anlegen" };

/** "Anfrage anlegen" for the Empfang: a person called the Praxis or walked in. */
export default async function AnfrageAnlegenPage() {
  const session = await requirePermissionOrRedirect("requests.update");
  const treatments = (await listTreatments(session.clinicId, session.userId))
    .filter((t) => t.isActive)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/anfragen"
        className="inline-flex items-center gap-2 text-sm font-medium text-fg-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Zurück zu den Anfragen
      </Link>
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Anfrage anlegen.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Für Personen, die in der Praxis anrufen oder vorbeikommen. So steht jede Anfrage an
          einem Ort, mit Wiedervorlage und Auswertung.
        </p>
      </header>
      <Card>
        <CardContent className="p-5 md:p-6">
          <ManualEntryForm treatments={treatments} />
        </CardContent>
      </Card>
      <p className="text-sm text-fg-primary">
        Von Hand angelegte Anfragen zählen nie für die Garantie „Keine Anfrage, keine Rechnung“.
        Dafür zählen nur Anfragen über einen EINS-Messweg.
      </p>
    </div>
  );
}
