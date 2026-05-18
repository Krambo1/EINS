"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@eins/ui";

interface GlobalSearchProps {
  onOpen: () => void;
}

/**
 * Visible search trigger that lives at the top of the sidebar / drawer. State,
 * keyboard shortcuts, and the dialog itself are owned by PortalShell so the
 * trigger can render in multiple places (desktop rail + mobile drawer) without
 * spawning duplicate dialogs.
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
        "group flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-bg-secondary/40 px-3 text-sm text-fg-secondary transition-colors",
        "hover:border-fg-tertiary hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary"
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Suchen…</span>
      <kbd
        aria-hidden
        className="hidden items-center gap-0.5 rounded border border-border bg-bg-primary px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight text-fg-secondary md:inline-flex"
      >
        {isMac ? "⌘" : "Strg"} K
      </kbd>
    </button>
  );
}
