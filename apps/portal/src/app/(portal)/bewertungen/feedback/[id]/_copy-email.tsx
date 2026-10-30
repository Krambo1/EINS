"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { showActionFlash } from "../../../_components/flash-event";

/**
 * Copies the address beside it (Attio's copy on a record's e-mail field):
 * one tap, a tick for a moment, the toast confirms. Only offered when the
 * patient asked to be contacted.
 */
export function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      showActionFlash({ tone: "good", title: "E-Mail-Adresse kopiert", description: email });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht kopiert",
        description: "Ihr Browser hat das Kopieren nicht erlaubt. Markieren Sie die Adresse und kopieren Sie sie selbst.",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="E-Mail-Adresse kopieren"
      title="Kopieren"
      className="-my-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-small)] text-fg-secondary transition-colors hover:bg-[var(--hover-wash)] hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {copied ? <Check className="h-4 w-4 text-tone-good" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
    </button>
  );
}
