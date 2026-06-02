"use client";

import { useState } from "react";
import { Button } from "@eins/ui";
import { Copy, Check } from "lucide-react";

/**
 * Kopiert den übergebenen Text in die Zwischenablage und zeigt für kurze
 * Zeit eine "Kopiert"-Bestätigung. Clipboard-Muster aus
 * _pvs-token-card.tsx übernommen.
 */
export function CopyButton({
  text,
  label = "Kopieren",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button size="sm" variant="outline" onClick={copy}>
      {copied ? (
        <>
          <Check className="mr-1.5 h-4 w-4" />
          Kopiert
        </>
      ) : (
        <>
          <Copy className="mr-1.5 h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
