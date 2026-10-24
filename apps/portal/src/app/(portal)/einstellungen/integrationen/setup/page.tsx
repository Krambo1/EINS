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
import {
  ArrowRight,
  FileSpreadsheet,
  Server,
  Webhook,
  Workflow,
  Building2,
} from "lucide-react";

export const metadata = { title: "PVS-Integration einrichten" };

/**
 * Vendor picker. Each card links to a per-vendor sub-page that walks the
 * inhaber through credential capture, OAuth dance (where needed), or the
 * agent-installer download.
 *
 * Status legend:
 *   • V1   — fully functional today
 *   • V1.5 — adapter exists, awaiting your credentials
 */

interface VendorOption {
  vendorKey: string;
  title: string;
  short: string;
  badge: "V1" | "V1.5";
  recommended?: boolean;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: VendorOption[] = [
  {
    vendorKey: "csv_upload",
    title: "CSV-Upload",
    short:
      "Funktioniert mit jeder Praxis-Software. Eine CSV-Datei ist eine einfache Tabelle, die fast jede Praxis-Software ausgeben kann. Sie exportieren Patienten, Termine, Behandlungen oder Rechnungen und laden die Datei hier hoch; ein Assistent führt Sie durch die Zuordnung.",
    badge: "V1",
    recommended: true,
    href: "/einstellungen/integrationen/setup/csv",
    icon: FileSpreadsheet,
  },
  {
    vendorKey: "gdt_agent",
    title: "GDT-Agent (auf Ihrem Praxisrechner)",
    short:
      "Für Praxis-Software, die auf Ihren eigenen Rechnern läuft (CGM, pixelmedic, x.concept usw.). GDT ist ein Standard-Dateiformat, über das Praxis-Software Daten austauscht. Ein kleines Programm auf einem Praxisrechner liest diese Dateien und sendet sie verschlüsselt ans Portal.",
    badge: "V1",
    href: "/einstellungen/integrationen/setup/gdt-agent",
    icon: Server,
  },
  {
    vendorKey: "tomedo",
    title: "Tomedo",
    short:
      "Direkte Verbindung zu Tomedo (Zollsoft) über das Internet. Sie melden sich einmal bei Tomedo an und erlauben den Zugriff, ohne Installation.",
    badge: "V1.5",
    href: "/einstellungen/integrationen/setup/tomedo",
    icon: Webhook,
  },
  {
    vendorKey: "red",
    title: "RED interchange",
    short:
      "Direkte Verbindung über die Standard-Schnittstelle von RED (FHIR). Sie erzeugen in RED Zugangsdaten, fügen sie hier ein, danach laufen die Daten automatisch.",
    badge: "V1.5",
    href: "/einstellungen/integrationen/setup/red",
    icon: Webhook,
  },
  {
    vendorKey: "medatixx",
    title: "medatixx, psyx, x.isynet (via GDT)",
    short:
      "Für medatixx und psyx: Wir nutzen die GDT-Ausgabe von medatixx. Ein kleines Programm von EINS läuft auf einem Praxisrechner und überträgt Patienten und Behandlungen automatisch ans Portal.",
    badge: "V1",
    href: "/einstellungen/integrationen/setup/medatixx",
    icon: Building2,
  },
  {
    vendorKey: "n8n_custom",
    title: "n8n Workflow",
    short:
      "Für jede andere Praxis-Software. n8n ist ein Werkzeug für Automatisierungen, das meist Ihre IT einrichtet: Sie übernimmt unsere Vorlage und passt den Auslöser an Ihre Praxis-Software an.",
    badge: "V1",
    href: "/einstellungen/integrationen/setup/n8n",
    icon: Workflow,
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
          Wählen Sie, wie Ihr Praxisverwaltungssystem (PVS, die Software für
          Termine, Patienten und Rechnungen) mit dem Portal verbunden wird.
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
                  <opt.icon className="h-5 w-5" />
                  {opt.title}
                </CardTitle>
                <div className="flex flex-wrap justify-end gap-1">
                  {opt.recommended && (
                    <Badge tone="good">Empfohlen</Badge>
                  )}
                  <Badge tone={opt.badge === "V1" ? "good" : "neutral"}>
                    {opt.badge === "V1" ? "Sofort nutzbar" : "In Vorbereitung"}
                  </Badge>
                </div>
              </div>
              <CardDescription>{opt.short}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
              <Button asChild variant="outline" className="w-full">
                <Link href={opt.href}>
                  Einrichten <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
