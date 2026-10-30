"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@eins/ui";

interface GlobalSearchProps {
  onOpen: () => void;
}

/**
 * Visible search trigger that lives at the top of the sidebar / drawer.
 */
export function GlobalSearch({ onOpen }: GlobalSearchProps) {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Suchen (Tastenkürzel Strg + K)"
      className={cn(
        "group flex h-8 w-full items-center gap-2 rounded border border-border px-2.5 text-sm text-fg-secondary transition-colors",
        "hover:border-fg-tertiary hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary"
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Suchen…</span>
      <kbd
        aria-hidden
        className="hidden items-center gap-0.5 rounded-sm border border-border px-1 py-0.5 font-mono text-[11px] text-fg-secondary md:inline-flex"
      >
        {isMac ? "⌘" : "Strg"} K
      </kbd>
    </button>
  );
}
