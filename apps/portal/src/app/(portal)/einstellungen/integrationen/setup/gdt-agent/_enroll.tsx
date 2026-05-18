"use client";

import { useState } from "react";
import { Button, Input, Label } from "@eins/ui";
import { issueAgentEnrollmentAction } from "../../actions";
import { Copy, Loader2, KeyRound, Check } from "lucide-react";

export function GdtAgentEnroll() {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fingerprint, setFingerprint] = useState("");

  async function generate() {
    setBusy(true);
    setError(null);
    setToken(null);
    const r = await issueAgentEnrollmentAction({
      expectedFingerprint: fingerprint.trim() || undefined,
    });
    if (!r.ok) {
      setError(r.error);
    } else {
      setToken(r.token);
    }
    setBusy(false);
  }

  async function copy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fingerprint">
          Erwarteter Host-Fingerprint (optional)
        </Label>
        <Input
          id="fingerprint"
          placeholder="z.B. PRAXIS-PC-01"
          value={fingerprint}
          onChange={(e) => setFingerprint(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Wenn Sie den Hostnamen des Praxis-Rechners kennen, tragen Sie ihn ein.
          Der Code funktioniert dann nur auf genau diesem Gerät — Schutz gegen
          Code-Diebstahl.
        </p>
      </div>

      <Button onClick={generate} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
        Einrichtungs-Code generieren
      </Button>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {token && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            ⚠️ Dieser Code wird nur jetzt angezeigt.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">
              {token}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer">Installer-Befehl anzeigen</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-background p-2">
              {`eins-agent --enroll ${token}`}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
