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
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">
          Tomedo
          <Badge tone="neutral" className="ml-3">In Vorbereitung</Badge>
        </h1>
        <p className="mt-1 text-base text-fg-primary">
          Direkte Verbindung zu Tomedo (Zollsoft) über das Internet. Sie melden
          sich einmal bei Tomedo an und erlauben EINS den Zugriff, ohne
          Installation.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Wir testen diese Verbindung gerade mit Zollsoft. Wir melden uns,
            sobald sie bereitsteht.
          </p>
          <p>
            <strong>In der Zwischenzeit:</strong> nutzen Sie CSV-Upload (Tomedo
            bietet Exporte unter <em>Administration → Datenexport</em>) oder
            einen n8n-Ablauf, den Ihre IT einrichtet.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-fg-secondary">
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
