"use client";

import { ArrowUp } from "lucide-react";

export function BackToTop() {
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="mt-10 inline-flex items-center gap-2 rounded-full border border-border bg-bg-secondary/60 px-4 py-2 font-mono text-sm text-fg-primary backdrop-blur-sm transition-colors hover:border-accent/60 hover:text-accent"
      aria-label="Nach oben scrollen"
    >
      <ArrowUp className="h-4 w-4" />
      Nach oben
    </button>
  );
}
