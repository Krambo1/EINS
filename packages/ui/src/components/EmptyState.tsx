import * as React from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  /** Large friendly icon — pass a lucide icon or emoji */
  icon?: React.ReactNode;
  title: string;
  /** One sentence, Klartext. */
  description?: string;
  /** Optional primary action */
  action?: React.ReactNode;
  className?: string;
}

/**
 * EmptyState — shown when a list is empty (no Anfragen yet, no Anzeigen verbunden, ...)
 * Optimistic and helpful, not "404".
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-bg-secondary/40 p-10 text-center",
        className
      )}
    >
      {icon && (
        <div className="grid h-16 w-16 place-items-center rounded-full bg-bg-primary text-accent">
          {icon}
        </div>
      )}
      <h3 className="opa-h3">{title}</h3>
      {description && <p className="opa-body max-w-md">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
