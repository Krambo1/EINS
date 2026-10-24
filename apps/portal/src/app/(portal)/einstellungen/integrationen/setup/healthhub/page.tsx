import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@eins/ui";
import { ArrowRight } from "lucide-react";
import { requireSession } from "@/auth/guards";

export const metadata = { title: "medatixx HealthHub" };

export default async function HealthHubSetupPage() {
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
          medatixx HealthHub
          <Badge tone="warn" className="ml-3">
            Nicht verfügbar
          </Badge>
        </h1>
        <p className="mt-1 text-base text-fg-primary">
          Die native medatixx-HealthHub-Schnittstelle ist für EINS derzeit nicht
          verfügbar. medatixx hat den Software-Partner-Antrag abgelehnt.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Der dauerhafte Weg für medatixx: GDT-Agent
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Für medatixx-Praxen ist der <strong>GDT-Agent</strong> der vorgesehene
            Weg. GDT ist ein Standard-Dateiformat, über das Praxis-Software Daten
            austauscht. Der Agent läuft als kleines Programm auf einem
            Praxisrechner, liest
            die GDT-Exporte aus medatixx und sendet sie verschlüsselt ans Portal.
            GDT ist in jeder medatixx-Lizenz enthalten, keine Akkreditierung,
            keine Wartezeit.
          </p>
          <p className="text-fg-secondary">
            Die Einrichtung dauert rund 20 Minuten. Sie brauchen
            Administrator-Rechte auf einem Praxisrechner, der dauerhaft läuft.
          </p>
          <Button asChild className="w-full sm:w-auto h-auto min-h-11 whitespace-normal py-2 text-left">
            <Link href="/einstellungen/integrationen/setup/medatixx">
              medatixx mit GDT-Agent verbinden
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alternative: CSV-Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-fg-secondary">
            Wenn auf der Praxis kein dauerhaft laufender PC vorhanden ist oder
            Sie nur monatlich abgleichen möchten, können Sie den
            medatixx-Datenexport (Patienten, Behandlungen, Abrechnungen) auch
            als CSV ins Portal laden.
          </p>
          <Link
            href="/einstellungen/integrationen/setup/csv"
            className="text-sm font-medium underline"
          >
            Zum CSV-Upload →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
