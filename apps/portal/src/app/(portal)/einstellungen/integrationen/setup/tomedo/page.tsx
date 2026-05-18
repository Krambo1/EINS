import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@eins/ui";
import { requireSession } from "@/auth/guards";

export const metadata = { title: "Tomedo einrichten" };

export default async function TomedoSetupPage() {
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
          Tomedo
          <Badge tone="neutral" className="ml-3 text-xs">V1.5 – in Vorbereitung</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nativer Adapter gegen die Zollsoft Tomedo-Cloud-API. Verbinden in
          drei Minuten via OAuth.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Der Adapter wird gerade gegen den Zollsoft-Sandbox-Tenant
            verifiziert. Erwartete Verfügbarkeit: Wochen 3-5 der PVS-Bridge-Roadmap.
          </p>
          <p>
            <strong>In der Zwischenzeit:</strong> nutzen Sie CSV-Upload (Tomedo
            bietet Exporte unter <em>Administration → Datenexport</em>) oder
            n8n-Workflow mit Tomedo-HTTP-Trigger.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            <li>
              <Link
                href="/einstellungen/integrationen/setup/csv"
                className="underline"
              >
                CSV-Upload starten
              </Link>
            </li>
            <li>
              <Link
                href="/einstellungen/integrationen/setup/n8n"
                className="underline"
              >
                n8n-Workflow einrichten
              </Link>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
