"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  id?: string;
  name?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: React.ReactNode;
  required?: boolean;
  error?: string;
}

export function Checkbox({
  id,
  name,
  checked,
  onCheckedChange,
  label,
  required,
  error,
}: CheckboxProps) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-brand border border-brand-border bg-brand-bg p-3 transition-colors",
          "hover:border-brand-fg/30",
          checked && "border-brand-primary bg-brand-primary-soft/40",
          error && "border-red-500",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded border transition-colors",
            checked ? "border-brand-primary bg-brand-primary" : "border-brand-border bg-brand-bg",
          )}
          aria-hidden
        >
          {checked && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <input
          id={inputId}
          name={name}
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          aria-required={required}
          aria-invalid={Boolean(error)}
        />
        <span className="text-sm leading-snug text-brand-fg">{label}</span>
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
