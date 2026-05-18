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
            className="text-muted-foreground hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">
          medatixx HealthHub
          <Badge tone="warn" className="ml-3 text-xs">
            Nicht verfügbar
          </Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
            Weg. Er läuft als kleiner Hintergrund-Dienst auf dem Praxis-PC, liest
            die GDT-Exporte aus medatixx und sendet sie verschlüsselt ans Portal.
            GDT ist in jeder medatixx-Lizenz enthalten, keine Akkreditierung,
            keine Wartezeit.
          </p>
          <p className="text-muted-foreground">
            Setup-Dauer: rund 20 Minuten. Sie brauchen Admin-Rechte auf einem
            Praxis-PC, der dauerhaft läuft.
          </p>
          <Button asChild className="w-full sm:w-auto">
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
          <p className="text-muted-foreground">
            Wenn auf der Praxis kein dauerhaft laufender PC vorhanden ist oder
            Sie nur monatlich abgleichen möchten, können Sie den
            medatixx-Datenexport (Patienten, Behandlungen, Abrechnungen) auch
            als CSV ins Portal laden.
          </p>
          <Link
            href="/einstellungen/integrationen/setup/csv"
            className="text-sm font-medium underline"
          >
            Zum CSV-Wizard →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
