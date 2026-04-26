import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { HwgForm } from "./HwgForm";

export const metadata = { title: "HWG-Check" };

export default async function HwgCheckPage() {
  await requirePermissionOrRedirect("tools.hwg_check");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">HWG-Check.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Vorab-Prüfung Ihrer Werbetexte gegen die häufigsten Verstöße gegen das
          Heilmittelwerbegesetz.
        </p>
      </header>

      <HwgForm />

      <Card>
        <CardHeader>
          <CardTitle>Was die Prüfung leistet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-base text-fg-primary">
          <p>
            Die Prüfung sucht nach typischen Formulierungen, die in Deutschland
            bei Werbung für Heilbehandlungen problematisch sind. Dazu gehören
            Erfolgsgarantien, Vorher-Nachher-Bilder, Patientenstimmen bei
            Eingriffen und verbotene Superlative.
          </p>
          <p>
            <strong>Rot</strong> bedeutet: klarer Verstoß, so nicht
            veröffentlichen. <strong>Gelb</strong> heißt: Graubereich, bitte
            individuell prüfen. Ein sauberes Ergebnis ist keine Rechtsberatung,
            entbindet aber bei Routinetexten von der Sorge, etwas offensichtlich
            Falsches zu übersehen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
