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
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">GDT-Agent</h1>
        <p className="mt-1 text-base text-fg-primary">
          Für lokal installierte Praxis-Software (CGM Albis, x.concept, pixelmedic,
          DURIA und alle, die GDT/BDT ausgeben können). GDT ist ein
          Standard-Dateiformat, über das Praxis-Software Daten austauscht. Der
          EINS-Agent läuft als kleines Programm auf einem Praxisrechner, liest
          neue GDT-Dateien aus einem Ordner und sendet sie verschlüsselt ans
          Portal.
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
              (24 Stunden gültig).
            </li>
            <li>
              In Ihrer Praxis: laden Sie den Installer (Windows MSI oder Mac DMG)
              herunter und starten ihn mit dem Code.
            </li>
            <li>
              Der Agent verbindet sich, erhält einen eigenen geheimen Schlüssel
              und überwacht den GDT-Ordner Ihrer Praxis-Software.
            </li>
            <li>
              Richten Sie in Ihrer Praxis-Software einen GDT-Partner mit dem Ziel-Ordner
              des Agents. Termine, Behandlungen und Rechnungen fließen automatisch
              ins Portal.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Einrichtungs-Code erzeugen</CardTitle>
          <CardDescription>
            Inhaber-Rolle erforderlich. Der Code wird nur einmal angezeigt. Bei
            Verlust einfach einen neuen erzeugen.
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
                    <code className="text-sm text-fg-secondary">
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
