"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@eins/ui";
import { Copy, Check, Link2 } from "lucide-react";

/**
 * Direction A — token surfacing for MFA copy-paste.
 *
 * Renders the EINS-Lead-{8hex} token derived from the request id, with a
 * one-click copy button + a short instruction telling MFA where to paste
 * it inside the PVS so the Bridge can Stage-2-link the next event.
 *
 * For write-capable adapters (Tomedo, RED, HealthHub, n8n) the bridge
 * writes the token automatically; this card is the manual fallback for
 * GDT-Agent / CSV-only clinics.
 */
export function PvsTokenCard({
  token,
  pvsVendor,
}: {
  token: string;
  pvsVendor: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Adapters that automatically write back the token. Mention that the
  // bridge will attempt to insert it, so MFA doesn't double-paste.
  const supportsAutoWrite =
    pvsVendor === "tomedo" ||
    pvsVendor === "red" ||
    pvsVendor === "healthhub" ||
    pvsVendor === "n8n_custom";

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Link2 className="h-4 w-4" />
          PVS-Verknüpfung
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-fg-secondary">
          {supportsAutoWrite
            ? "EINS hat versucht, diesen Code automatisch in die PVS-Bemerkung zu schreiben. Falls das nicht geklappt hat, bitte manuell beim Anlegen des Patienten einfügen:"
            : "Diesen Code beim Anlegen des Patienten in der PVS in das Bemerkungs-Feld einfügen. Dadurch verknüpft EINS den späteren Termin automatisch mit dieser Anfrage."}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-bg-secondary p-2 font-mono text-xs">
            {token}
          </code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
