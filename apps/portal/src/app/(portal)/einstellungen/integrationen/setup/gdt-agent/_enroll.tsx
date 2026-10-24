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
          Name des Praxisrechners (optional)
        </Label>
        <Input
          id="fingerprint"
          placeholder="z.B. PRAXIS-PC-01"
          value={fingerprint}
          onChange={(e) => setFingerprint(e.target.value)}
        />
        <p className="text-sm text-fg-secondary">
          Wenn Sie den Namen des Praxisrechners kennen, tragen Sie ihn ein.
          Der Code funktioniert dann nur auf genau diesem Gerät. Das schützt gegen
          Code-Diebstahl.
        </p>
      </div>

      <Button onClick={generate} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
        Einrichtungs-Code erzeugen
      </Button>

      {error && (
        <p className="text-sm text-tone-bad">{error}</p>
      )}

      {token && (
        <div className="space-y-3 rounded-md border bg-bg-secondary p-3">
          <p className="text-sm font-medium">
            Dieser Code wird nur jetzt angezeigt.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-bg-primary p-2 font-mono text-sm">
              {token}
            </code>
            <Button size="sm" variant="outline" onClick={copy} aria-label="Code kopieren">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Befehl für die Installation anzeigen</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-bg-primary p-2">
              {`eins-agent --enroll ${token}`}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
