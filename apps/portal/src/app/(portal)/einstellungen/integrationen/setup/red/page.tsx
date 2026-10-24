import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@eins/ui";
import { requireSession } from "@/auth/guards";

export const metadata = { title: "RED interchange einrichten" };

export default async function RedSetupPage() {
  await requireSession();
  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen/setup"
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">
          RED interchange
          <Badge tone="neutral" className="ml-3">In Vorbereitung</Badge>
        </h1>
        <p className="mt-1 text-base text-fg-primary">
          Direkte Verbindung über die Standard-Schnittstelle von RED. FHIR ist
          ein verbreitetes Austauschformat für Gesundheitsdaten. Sie erzeugen in
          RED Zugangsdaten und fügen sie hier ein.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Der RED-Adapter implementiert FHIR-Subscriptions. Sobald die
            Praxis in RED unter <em>Einstellungen → API-Zugang</em> Client-Credentials
            generiert hat, trägt sie diese hier ein, und EINS abonniert
            automatisch Patient/Appointment/Encounter/Invoice-Resources.
          </p>
          <p>
            <strong>Noch nicht verfügbar.</strong> Wir melden uns, sobald diese
            Verbindung bereitsteht. Bis dahin können Sie den CSV-Upload nutzen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
