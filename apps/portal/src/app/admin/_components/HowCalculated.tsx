import * as React from "react";

/**
 * Collapsible "Wie wird gerechnet?" under an admin page header (DS5): the page
 * subtitle stays one line, the long rule explanation folds away so the table
 * starts higher, especially on the phone.
 */
export function HowCalculated({
  summary = "Wie wird gerechnet?",
  children,
}: {
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group max-w-3xl rounded-lg border border-border bg-bg-secondary px-4 py-3">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-base font-medium text-fg-primary [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2 space-y-2 text-base text-fg-primary">{children}</div>
    </details>
  );
}
