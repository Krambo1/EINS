import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { N8nSecretReveal } from "./_reveal";

export const metadata = { title: "n8n Workflow einrichten" };

export default async function N8nSetupPage() {
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
        <h1 className="text-2xl font-semibold">n8n Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Für jede PVS, die wir nicht nativ unterstützen. Sie hosten n8n
          selbst (oder nutzen unsere geteilte Instanz), importieren unser
          Template, passen den Trigger an Ihre PVS an, fertig.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">So funktioniert es</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm">
            <li>
              Generieren Sie unten ein Verschlüsselungs-Geheimnis (HMAC-Secret).
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
              das Secret + Ihre <code>clinicId</code> in die Credentials eintragen.
            </li>
            <li>
              Aktivieren. Events fließen an{" "}
              <code>POST /api/pvs/events</code> mit HMAC-Signatur.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">HMAC-Geheimnis verwalten</CardTitle>
          <CardDescription>
            Wird einmal angezeigt. Bei Verlust einfach rotieren — alte Geheimnisse
            werden sofort ungültig.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <N8nSecretReveal />
        </CardContent>
      </Card>
    </div>
  );
}
