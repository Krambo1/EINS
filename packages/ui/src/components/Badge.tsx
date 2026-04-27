import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        good: "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] text-tone-good",
        warn: "border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] text-tone-warn",
        bad: "border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] text-tone-bad",
        neutral: "border-border bg-bg-secondary text-fg-primary",
        accent: "border-accent/30 bg-accent-soft text-accent",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
