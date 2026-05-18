import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { GdtAgentEnroll } from "./_enroll";
import { listOpenAgentEnrollmentsAction } from "../../actions";
import { formatRelative } from "@/lib/formatting";

export const metadata = { title: "GDT-Agent installieren" };

export default async function GdtAgentSetupPage() {
  await requireSession();
  const open = await listOpenAgentEnrollmentsAction();

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
        <h1 className="text-2xl font-semibold">GDT-Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Für lokal installierte Praxis-Software (CGM Albis, x.concept, pixelmedic,
          DURIA und alle, die GDT/BDT exportieren können). Der EINS-Agent läuft als
          Hintergrunddienst auf dem Praxis-PC, liest neue GDT-Dateien aus einem
          überwachten Ordner und sendet sie verschlüsselt ans Portal.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">So funktioniert es</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm">
            <li>
              Sie generieren unten einen einmaligen <strong>Einrichtungs-Code</strong>{" "}
              (24h gültig).
            </li>
            <li>
              In Ihrer Praxis: laden Sie den Installer (Windows MSI oder Mac DMG)
              herunter und starten ihn mit dem Code.
            </li>
            <li>
              Der Agent verbindet sich, erhält ein eigenes Verschlüsselungs-Geheimnis,
              und überwacht den GDT-Ordner Ihrer PVS.
            </li>
            <li>
              Konfigurieren Sie in Ihrer PVS einen GDT-Partner mit dem Ziel-Ordner
              des Agents. Termine, Behandlungen und Rechnungen fließen automatisch
              ins Portal.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Einrichtungs-Code generieren</CardTitle>
          <CardDescription>
            Inhaber-Rolle erforderlich. Der Code wird nur einmal angezeigt — bei
            Verlust einfach neuen generieren.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GdtAgentEnroll />
        </CardContent>
      </Card>

      {open.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Offene Einrichtungs-Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {open.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  <span>Gültig bis {formatRelative(e.expiresAt)}</span>
                  {e.expectedFingerprint && (
                    <code className="text-xs text-muted-foreground">
                      {e.expectedFingerprint}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
