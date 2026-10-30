"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@eins/ui";
import type { DocumentKind } from "@/lib/constants";
import { RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { useFileList } from "./FileList";
import { KIND_FILTER_LABELS } from "../_lib/von-eins";

const ALL_LABEL = "Alle Arten";

const MENU =
  "max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[13rem] overflow-auto rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]";

/**
 * Art filter of the "Von EINS" card, at the right end of its title row
 * (Attio's Files tab). It always has a value, so it stands raised like the
 * sort control on Anfragen. Every label of every Art sits in one grid cell
 * with only the current one visible: the control is as wide as the longest
 * label there is, whatever is picked and whichever kinds this Praxis has, so
 * it never moves and the skeleton knows its width. Only kinds the role can
 * see are offered. Picking one shows that Art at once (FileListState, no round
 * trip) and goes back to the first page of the card.
 */
export function KindFilter({ kinds }: { kinds: DocumentKind[] }) {
  const list = useFileList();
  if (!list) throw new Error("KindFilter must sit inside FileListState");
  const kind = list.kind as DocumentKind | undefined;
  const labels = [ALL_LABEL, ...Object.values(KIND_FILTER_LABELS)];
  const current = kind ? KIND_FILTER_LABELS[kind] : ALL_LABEL;
  const pick = (next?: DocumentKind) => list.setKind(next);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Art: ${current}`}
        className={cn(
          RAISED_CONTROL,
          "inline-flex h-[var(--control-h)] items-center gap-1.5 rounded-[var(--r-control)] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        )}
      >
        <span className="inline-grid">
          {labels.map((l) => (
            <span
              key={l}
              aria-hidden
              className={cn("col-start-1 row-start-1 whitespace-nowrap text-left", l !== current && "invisible")}
            >
              {l}
            </span>
          ))}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU}>
        <DropdownMenuItem onSelect={() => pick()} className="justify-between gap-6">
          {ALL_LABEL}
          {!kind && <Check className="h-4 w-4 shrink-0 text-fg-primary" aria-hidden />}
        </DropdownMenuItem>
        {kinds.map((k) => (
          <DropdownMenuItem key={k} onSelect={() => pick(k)} className="justify-between gap-6">
            {KIND_FILTER_LABELS[k]}
            {kind === k && <Check className="h-4 w-4 shrink-0 text-fg-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
