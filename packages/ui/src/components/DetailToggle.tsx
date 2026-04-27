"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export type UiMode = "einfach" | "detail";

export interface DetailToggleProps {
  value: UiMode;
  onChange: (mode: UiMode) => void;
  className?: string;
  /** Labels override — defaults to German "Einfach" / "Detail". */
  labels?: { einfach: string; detail: string };
}

/**
 * DetailToggle — Einfach / Detail switch, top-right on every dashboard.
 *
 * Default is 'einfach'. Selection persists per user in `clinic_users.ui_mode`
 * (apps/portal/src/app/api/me/ui-mode/route.ts handles that).
 */
export function DetailToggle({
  value,
  onChange,
  className,
  labels = { einfach: "Einfach", detail: "Detail" },
}: DetailToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Anzeigemodus"
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-bg-secondary p-1",
        className
      )}
    >
      {(["einfach", "detail"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "opa-focus-ring rounded-full px-4 py-2 text-sm font-medium transition-colors",
            value === mode
              ? "bg-bg-primary text-fg-primary shadow-sm"
              : "text-fg-secondary hover:text-fg-primary"
          )}
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  );
}
