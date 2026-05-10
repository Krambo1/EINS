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
  const buttonRefs = React.useRef<Record<UiMode, HTMLButtonElement | null>>({
    einfach: null,
    detail: null,
  });
  const [pill, setPill] = React.useState<{ left: number; width: number } | null>(null);

  React.useEffect(() => {
    const measure = () => {
      const btn = buttonRefs.current[value];
      if (!btn) return;
      setPill({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();

    // Re-measure on font load / custom-label width changes.
    const ro = new ResizeObserver(measure);
    Object.values(buttonRefs.current).forEach((b) => {
      if (b) ro.observe(b);
    });
    return () => ro.disconnect();
  }, [value]);

  return (
    <div
      role="radiogroup"
      aria-label="Anzeigemodus"
      className={cn(
        "relative inline-flex items-center rounded-full border border-border bg-bg-tertiary p-0.5 shadow-[inset_0_1px_2px_rgba(16,16,26,0.06)]",
        className
      )}
    >
      {pill && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0.5 bottom-0.5 rounded-full bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)] transition-[transform,width] duration-300 ease-out will-change-transform"
          style={{
            transform: `translate3d(${pill.left}px, 0, 0)`,
            width: pill.width,
          }}
        />
      )}
      {(["einfach", "detail"] as const).map((mode) => (
        <button
          key={mode}
          ref={(el) => {
            buttonRefs.current[mode] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "opa-focus-ring relative z-10 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-300",
            value === mode ? "text-bg-primary" : "text-fg-secondary hover:text-fg-primary",
            // SSR / pre-measurement fallback: keep the active bg on the button
            // itself until the pill mounts, otherwise the active label flashes
            // as light-on-light. Pill takes over silently once measured.
            value === mode && !pill && "bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
          )}
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  );
}
