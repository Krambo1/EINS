"use client";

import * as React from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

export interface RadioCardOption {
  id: string;
  label: string;
  hint?: string;
}

interface RadioCardGroupProps {
  name: string;
  value: string | null;
  onValueChange: (next: string) => void;
  options: RadioCardOption[];
  /** Two columns on phones, three on tablets+ */
  cols?: 1 | 2 | 3;
  ariaLabel: string;
}

export function RadioCardGroup({
  name,
  value,
  onValueChange,
  options,
  cols = 2,
  ariaLabel,
}: RadioCardGroupProps) {
  const colClass =
    cols === 1
      ? "grid-cols-1"
      : cols === 3
        ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";
  return (
    <RadioGroup.Root
      name={name}
      value={value ?? undefined}
      onValueChange={onValueChange}
      aria-label={ariaLabel}
      className={cn("grid gap-2", colClass)}
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <RadioGroup.Item
            key={opt.id}
            value={opt.id}
            className={cn(
              "group relative flex min-h-[64px] flex-col items-start justify-center rounded-brand border bg-brand-bg p-4 text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2",
              selected
                ? "border-brand-primary bg-brand-primary-soft/40 shadow-[0_4px_12px_-6px_color-mix(in_oklab,var(--brand-primary)_30%,transparent)]"
                : "border-brand-border hover:border-brand-fg/30",
            )}
          >
            <span className="font-medium leading-snug text-brand-fg">{opt.label}</span>
            {opt.hint && (
              <span className="mt-0.5 text-sm text-brand-fg-muted">{opt.hint}</span>
            )}
            <span
              aria-hidden
              className={cn(
                "absolute right-3 top-3 h-5 w-5 rounded-full border-2 transition-colors",
                selected ? "border-brand-primary bg-brand-primary" : "border-brand-border",
              )}
            >
              {selected && (
                <span className="block h-2 w-2 translate-x-1 translate-y-1 rounded-full bg-white" />
              )}
            </span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
