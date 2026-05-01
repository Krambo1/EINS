import * as React from "react";
import { cn } from "../lib/cn";

/** Map from Request-Status → tone + Klartext label. */
const statusConfig: Record<
  string,
  { label: string; dot: string; bg: string; fg: string }
> = {
  neu: {
    label: "Neu",
    dot: "bg-accent",
    bg: "bg-accent-soft",
    fg: "text-accent",
  },
  qualifiziert: {
    label: "Qualifiziert",
    dot: "bg-tone-good",
    bg: "bg-[var(--tone-good-bg)]",
    fg: "text-tone-good",
  },
  termin_vereinbart: {
    label: "Termin vereinbart",
    dot: "bg-tone-good",
    bg: "bg-[var(--tone-good-bg)]",
    fg: "text-tone-good",
  },
  beratung_erschienen: {
    label: "Beratung erschienen",
    dot: "bg-tone-good",
    bg: "bg-[var(--tone-good-bg)]",
    fg: "text-tone-good",
  },
  gewonnen: {
    label: "Gewonnen",
    dot: "bg-tone-good",
    bg: "bg-[var(--tone-good-bg)]",
    fg: "text-tone-good",
  },
  verloren: {
    label: "Verloren",
    dot: "bg-tone-bad",
    bg: "bg-[var(--tone-bad-bg)]",
    fg: "text-tone-bad",
  },
  spam: {
    label: "Spam",
    dot: "bg-fg-tertiary",
    bg: "bg-bg-secondary",
    fg: "text-fg-secondary",
  },
};

export interface StatusPillProps {
  status: keyof typeof statusConfig | string;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  const cfg = statusConfig[status] ?? statusConfig.neu;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        cfg.bg,
        cfg.fg,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}
