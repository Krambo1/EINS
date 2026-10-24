import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { N8nSecretReveal } from "./_reveal";

export const metadata = { title: "n8n Workflow einrichten" };

export default async function N8nSetupPage() {
  const session = await requireSession();
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
        <h1 className="text-2xl font-semibold">n8n Workflow</h1>
        <p className="mt-1 text-base text-fg-primary">
          Für jede Praxis-Software, die wir nicht direkt anbinden. n8n ist ein
          Werkzeug für Automatisierungen, das meist Ihre IT einrichtet: Sie
          betreibt n8n selbst (oder nutzt unseren gemeinsamen Zugang), übernimmt
          unsere Vorlage und passt den Auslöser an Ihre Praxis-Software an.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">So funktioniert es</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm">
            <li>
              Erzeugen Sie unten einen geheimen Schlüssel (HMAC-Secret). Er
              beweist dem Portal, dass die Daten wirklich von Ihrer Praxis
              kommen.
            </li>
            <li>
              Laden Sie unser n8n-Template herunter (
              <a
                href="/pvs-bridge/n8n-templates/canonical-emitter.json"
                className="underline"
                download
              >
                canonical-emitter.json
              </a>
              ).
            </li>
            <li>
              In Ihrer n8n-Instanz: Workflow importieren, den HTTP-Trigger durch
              Ihren PVS-spezifischen Trigger ersetzen (Polling, Webhook, ...),
              den geheimen Schlüssel und Ihre Praxis-Kennung (siehe unten) in
              die Zugangsdaten eintragen.
            </li>
            <li>
              Aktivieren. Die Meldungen gehen an{" "}
              <code>POST /api/pvs/events</code> mit HMAC-Signatur.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Geheimen Schlüssel (HMAC) verwalten</CardTitle>
          <CardDescription>
            Wird nur einmal angezeigt. Bei Verlust einfach einen neuen erzeugen,
            der alte gilt dann sofort nicht mehr.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-secondary p-3 text-sm">
            <div className="font-medium text-fg-primary">
              Ihre Praxis-Kennung für n8n
            </div>
            <code className="mt-1 block break-all font-mono text-fg-primary">
              {session.clinicId}
            </code>
          </div>
          <N8nSecretReveal />
        </CardContent>
      </Card>
    </div>
  );
}
