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
  Cog,
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
      "Funktioniert mit jeder PVS. Exportieren Sie Patienten/Termine/Behandlungen/Rechnungen aus Ihrer PVS und laden Sie sie hoch — Mapping geschieht im Wizard.",
    badge: "V1",
    recommended: true,
    href: "/einstellungen/integrationen/setup/csv",
    icon: FileSpreadsheet,
  },
  {
    vendorKey: "gdt_agent",
    title: "GDT-Agent (on-prem)",
    short:
      "Für lokal installierte PVS (CGM, pixelmedic, x.concept etc.): kleiner Windows-/Mac-Hintergrunddienst liest GDT-Dateien aus Ihrem Praxis-Netzwerk und sendet sie verschlüsselt ans Portal.",
    badge: "V1",
    href: "/einstellungen/integrationen/setup/gdt-agent",
    icon: Server,
  },
  {
    vendorKey: "tomedo",
    title: "Tomedo",
    short:
      "Native Cloud-API von Zollsoft. Verbinden in 3 Minuten via OAuth — keine Installation, kein Akkreditierungsantrag nötig.",
    badge: "V1.5",
    href: "/einstellungen/integrationen/setup/tomedo",
    icon: Webhook,
  },
  {
    vendorKey: "red",
    title: "RED interchange",
    short:
      "Native FHIR-Schnittstelle. Praxis generiert in RED Client-Credentials, fügt sie hier ein — danach läuft sync automatisch.",
    badge: "V1.5",
    href: "/einstellungen/integrationen/setup/red",
    icon: Webhook,
  },
  {
    vendorKey: "medatixx",
    title: "medatixx, psyx, x.isynet (via GDT)",
    short:
      "Für medatixx und psyx: wir nutzen den medatixx-internen GDT-Export. Unser Agent läuft auf dem Praxis-PC und überträgt Patienten und Behandlungen automatisch ans Portal.",
    badge: "V1",
    href: "/einstellungen/integrationen/setup/medatixx",
    icon: Building2,
  },
  {
    vendorKey: "n8n_custom",
    title: "n8n Workflow",
    short:
      "Für jede andere PVS-Software: importieren Sie unser n8n-Template, passen Sie den Trigger an Ihre PVS an, fertig.",
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
            className="text-muted-foreground hover:underline"
          >
            ← Zurück zur Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">PVS-Anbieter wählen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wählen Sie, wie Sie Ihre Patienten-Verwaltungs-Software mit dem Portal
          verbinden möchten. Bei Unsicherheit empfehlen wir CSV-Upload zum sofortigen
          Start — Sie können später auf eine native Integration wechseln.
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
                <div className="flex gap-1">
                  {opt.recommended && (
                    <Badge tone="good" className="text-[10px]">
                      Empfohlen
                    </Badge>
                  )}
                  <Badge
                    tone={opt.badge === "V1" ? "accent" : "neutral"}
                    className="text-[10px]"
                  >
                    {opt.badge}
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
