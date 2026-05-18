"use client";

import { useState } from "react";
import { Button } from "@eins/ui";
import { rotatePvsSecretAction } from "../../actions";
import { Copy, Loader2, KeyRound, Check, AlertTriangle } from "lucide-react";

export function N8nSecretReveal() {
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    if (
      secret !== null &&
      !confirm(
        "Wirklich rotieren? Das alte Geheimnis wird sofort ungültig — bereits deployte Workflows funktionieren nicht mehr, bis Sie das neue Geheimnis dort eintragen."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const r = await rotatePvsSecretAction();
    if (!r.ok) {
      setError(r.error);
    } else {
      setSecret(r.secretHex);
    }
    setBusy(false);
  }

  async function copy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      <Button onClick={rotate} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <KeyRound className="mr-2 h-4 w-4" />
        )}
        {secret ? "Neu rotieren" : "Geheimnis generieren"}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {secret && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Dieses Geheimnis wird nur jetzt angezeigt.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">
              {secret}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            In n8n eintragen als „X-EINS-Signature"-HMAC-Key, Algorithmus
            SHA-256, ausgegeben als <code>sha256=&lt;hex&gt;</code>.
          </p>
        </div>
      )}
    </div>
  );
}
