import * as React from "react";
import { cn } from "../lib/cn";

/** Map from Request-Status → tone + Klartext label. */
const statusConfig: Record<
  string,
  { label: string; dot: string }
> = {
  neu: {
    label: "Neu",
    dot: "bg-accent",
  },
  kontaktiert: {
    label: "Kontaktiert",
    dot: "bg-accent",
  },
  nicht_erreicht: {
    label: "Nicht erreicht",
    dot: "bg-tone-warn",
  },
  qualifiziert: {
    label: "Qualifiziert",
    dot: "bg-tone-good",
  },
  termin_vereinbart: {
    label: "Termin vereinbart",
    dot: "bg-tone-good",
  },
  beratung_erschienen: {
    label: "Beratung erschienen",
    dot: "bg-tone-good",
  },
  no_show: {
    label: "Nicht erschienen",
    dot: "bg-tone-bad",
  },
  behandelt: {
    label: "Behandelt",
    dot: "bg-tone-good",
  },
  gewonnen: {
    label: "Gewonnen",
    dot: "bg-tone-good",
  },
  verloren: {
    label: "Verloren",
    dot: "bg-tone-bad",
  },
  spam: {
    label: "Spam",
    dot: "bg-fg-tertiary",
  },
};

export interface StatusPillProps {
  status: keyof typeof statusConfig | string;
  className?: string;
}

/** Request status as a coloured dot and plain dark text (same look as Badge). */
export function StatusPill({ status, className }: StatusPillProps) {
  const cfg = statusConfig[status] ?? statusConfig.neu;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap align-middle text-sm font-medium leading-5 text-fg-primary",
        className
      )}
    >
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}
