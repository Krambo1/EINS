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
import { requireSession } from "@/auth/guards";

export const metadata = { title: "PVS-Integration einrichten" };

/**
 * Vendor picker. Each card links to a per-vendor sub-page that walks the
 * inhaber through credential capture, OAuth dance (where needed), or the
 * agent-installer download.
 */

interface VendorOption {
  vendorKey: string;
  title: string;
  short: string;
  recommended?: boolean;
  href: string;
}

const OPTIONS: VendorOption[] = [
  {
    vendorKey: "csv_upload",
    title: "CSV-Upload",
    short:
      "Funktioniert mit jeder Praxis-Software. Eine CSV-Datei ist eine einfache Tabelle, die fast jede Praxis-Software ausgeben kann. Sie exportieren Patienten, Termine, Behandlungen oder Rechnungen und laden die Datei hier hoch; ein Assistent führt Sie durch die Zuordnung.",
    recommended: true,
    href: "/einstellungen/integrationen/setup/csv",
  },
  {
    vendorKey: "gdt_agent",
    title: "GDT-Agent (auf Ihrem Praxisrechner)",
    short:
      "Für Praxis-Software, die auf Ihren eigenen Rechnern läuft (CGM, pixelmedic, x.concept usw.). GDT ist ein Standard-Dateiformat, über das Praxis-Software Daten austauscht. Ein kleines Programm auf einem Praxisrechner liest diese Dateien und sendet sie verschlüsselt ans Portal.",
    href: "/einstellungen/integrationen/setup/gdt-agent",
  },
  {
    vendorKey: "n8n_custom",
    title: "n8n Workflow",
    short:
      "Für jede andere Praxis-Software. n8n ist ein Werkzeug für Automatisierungen, das meist Ihre IT einrichtet: Sie übernimmt unsere Vorlage und passt den Auslöser an Ihre Praxis-Software an.",
    href: "/einstellungen/integrationen/setup/n8n",
  },
];

export default async function IntegrationenSetupPage() {
  await requireSession();

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen"
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Zurück zur Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">PVS-Anbieter wählen</h1>
        <p className="mt-1 text-base text-fg-primary">
          Wählen Sie, wie Ihr Praxisverwaltungssystem mit dem Portal verbunden
          wird.
          Im Zweifel starten Sie mit dem CSV-Upload. Sie können später auf eine
          direkte Verbindung wechseln.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {OPTIONS.map((opt) => (
          <Card key={opt.vendorKey} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {opt.title}
                </CardTitle>
                <div className="flex flex-wrap justify-end gap-1">
                  {opt.recommended && (
                    <Badge tone="good">Empfohlen</Badge>
                  )}
                  <Badge tone="good">Sofort nutzbar</Badge>
                </div>
              </div>
              <CardDescription>{opt.short}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
              <Button asChild variant="outline" className="w-full">
                <Link href={opt.href}>
                  Einrichten
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
