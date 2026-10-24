import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * Status label: a coloured dot and plain dark text, no box, no border, never
 * wraps. The tone shows only in the dot (or in an icon, which then replaces
 * the dot), so the text stays readable on any background. `neutral` is for
 * plain facts (source, treatment, "Aus"): grey text, no dot, so the dots stay
 * reserved for states that need attention or show progress.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap align-middle text-sm font-medium leading-5 text-fg-primary [&:has(svg)>[data-badge-dot]]:hidden [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        good: "[&>[data-badge-dot]]:bg-tone-good [&>svg]:text-tone-good",
        warn: "[&>[data-badge-dot]]:bg-tone-warn [&>svg]:text-tone-warn",
        bad: "[&>[data-badge-dot]]:bg-tone-bad [&>svg]:text-tone-bad",
        neutral: "font-normal text-fg-secondary [&>[data-badge-dot]]:hidden [&>svg]:text-fg-secondary",
        accent: "[&>[data-badge-dot]]:bg-accent [&>svg]:text-accent",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      <span data-badge-dot aria-hidden className="h-2 w-2 shrink-0 rounded-full" />
      {children}
    </span>
  );
}
