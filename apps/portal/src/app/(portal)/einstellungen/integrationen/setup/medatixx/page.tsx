import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
} from "@eins/ui";
import { ArrowRight, Building2, FileSpreadsheet, Server } from "lucide-react";
import { requireSession } from "@/auth/guards";

export const metadata = { title: "medatixx anbinden" };

export default async function MedatixxSetupPage() {
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
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Building2 className="h-6 w-6" />
          medatixx
          <Badge tone="good" className="ml-2">
            Sofort nutzbar
          </Badge>
        </h1>
        <p className="mt-1 text-base text-fg-primary">
          Für Praxen mit medatixx, psyx oder x.isynet. Anbindung über die
          GDT-Ausgabe von medatixx und den EINS-Agent, ein kleines Programm auf
          einem Praxisrechner. GDT ist ein Standard-Dateiformat, über das
          Praxis-Software Daten austauscht.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">So funktioniert es</CardTitle>
          <CardDescription>
            medatixx exportiert Patienten und Behandlungen als GDT-Dateien in
            einen Ordner. Der EINS-Agent liest diesen Ordner und schickt die
            Daten verschlüsselt ans Portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm">
            <li>
              GDT-Ordner auf dem Praxisrechner anlegen (z.B. <code>C:\EINS\gdt\</code>).
            </li>
            <li>
              In medatixx unter <em>Administration → Schnittstellen → GDT</em>{" "}
              den Export auf diesen Ordner einrichten.
            </li>
            <li>
              EINS-Agent installieren, Einrichtungs-Code und Ordner-Pfad
              eingeben.
            </li>
            <li>
              Fertig. Termine und Behandlungen fließen ab sofort automatisch
              ins Portal.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Warum nicht HealthHub?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-fg-secondary">
          <p>
            medatixx bietet mit HealthHub eine native Schnittstelle an, vergibt
            den Partner-Status aber nur an wenige Hersteller. EINS wurde
            abgelehnt. Der GDT-Weg liefert für unseren Anwendungsfall (Patienten,
            Termine, Behandlungen, Umsätze) dieselben Daten und ist sofort
            nutzbar.
          </p>
          <Link
            href="/einstellungen/integrationen/setup/healthhub"
            className="font-medium underline"
          >
            Details zu HealthHub →
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-5 w-5" /> GDT-Agent einrichten
            </CardTitle>
            <CardDescription>
              Empfohlener Weg. Die Einrichtung dauert rund 20 Minuten. Vorab die
              Schritt-für-Schritt-Anleitung lesen oder direkt starten.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button asChild className="w-full">
              <Link href="/einstellungen/integrationen/setup/gdt-agent">
                Installation starten
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <p className="text-sm text-fg-secondary">
              Die ausführliche Anleitung (GDT-Einstellung in medatixx,
              Einrichtungs-Code, Hilfe bei Problemen) schickt Ihnen EINS bei
              der Einrichtung zu.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-5 w-5" /> CSV-Upload
            </CardTitle>
            <CardDescription>
              Alternative für Praxen ohne dauerhaft laufenden Rechner oder zum
              monatlichen Abgleich der Umsätze. Funktioniert mit dem
              medatixx-Datenexport.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/einstellungen/integrationen/setup/csv">
                Zum CSV-Upload
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
