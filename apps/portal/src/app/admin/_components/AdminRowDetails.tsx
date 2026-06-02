"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@eins/ui";

export interface AdminRowDetailItem {
  label: React.ReactNode;
  value: React.ReactNode;
}

/**
 * Per-row "Details" popover used by `AdminTable` to demote low-signal columns
 * out of wide tables. The trigger is a compact chip; the popover lists each
 * demoted field as a label/value row. Values are pre-rendered server-side and
 * handed in as ReactNodes — this component only owns the open/close state.
 */
export function AdminRowDetails({
  items,
  label = "Details",
}: {
  items: AdminRowDetailItem[];
  label?: string;
}) {
  if (items.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg-secondary",
            "transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          )}
        >
          {label}
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <dl className="space-y-2 text-sm">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
            >
              <dt className="text-fg-secondary">{item.label}</dt>
              <dd className="text-right font-medium tabular-nums text-fg-primary">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
