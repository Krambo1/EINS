"use client";

import { useState } from "react";
import { Button } from "@eins/ui";
import { Check, Copy } from "lucide-react";

export function CopyLinkButton({ url, label = "Link kopieren" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (insecure context): nothing to do, the link is visible.
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Kopiert" : label}
    </Button>
  );
}
