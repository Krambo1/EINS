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
            className="text-muted-foreground hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Building2 className="h-6 w-6" />
          medatixx
          <Badge tone="accent" className="ml-2 text-xs">
            V1
          </Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Für Praxen mit medatixx, psyx oder x.isynet. Anbindung über den
          medatixx-internen GDT-Export plus den EINS-Agent auf dem Praxis-PC.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">So funktioniert es</CardTitle>
          <CardDescription>
            medatixx exportiert Patienten und Behandlungen als GDT-Dateien in
            einen Ordner. Der EINS-Agent liest diesen Ordner, parst die Dateien
            und schickt die Daten verschlüsselt ans Portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm">
            <li>
              GDT-Ordner auf dem Praxis-PC anlegen (z.B. <code>C:\EINS\gdt\</code>).
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
        <CardContent className="space-y-2 text-sm text-muted-foreground">
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
              Empfohlener Weg. Setup-Dauer rund 20 Minuten. Vorab die
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
            <p className="text-xs text-muted-foreground">
              Detail-Anleitung: GDT-Konfiguration in medatixx, Lead-Token-Setup,
              Troubleshooting.{" "}
              <a
                href="https://github.com/eins-visuals/EINSWebsite/blob/main/apps/bridge/agent/docs/SETUP-MEDATIXX.md"
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                Anleitung öffnen →
              </a>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-5 w-5" /> CSV-Upload
            </CardTitle>
            <CardDescription>
              Alternative für Praxen ohne dauerhaft laufenden PC oder zum
              monatlichen Abgleich der Umsätze. Funktioniert mit dem
              medatixx-Datenexport.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/einstellungen/integrationen/setup/csv">
                Zum CSV-Wizard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
