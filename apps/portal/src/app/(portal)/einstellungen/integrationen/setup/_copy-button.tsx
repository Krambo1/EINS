"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@eins/ui";
import { CONTROL, CONTROL_SQUARE, RAISED_CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";

/**
 * Copies one value (a code, a key, a command); the icon turns into a tick
 * for two seconds. Same size either way.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cn(
        RAISED_CONTROL,
        CONTROL,
        CONTROL_SQUARE,
        "inline-flex shrink-0 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      )}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
    </button>
  );
}
