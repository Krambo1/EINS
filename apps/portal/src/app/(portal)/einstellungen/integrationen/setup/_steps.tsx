import type { ReactNode } from "react";

/**
 * Numbered steps of a setup page (Stripe's onboarding checklist): the number
 * in a thin ring, the sentence beside it. A ring, not a grey disc, so no grey
 * area sits tight around a digit (DESIGN.md section 5). Static text, so the
 * page and its `loading.tsx` render the same block.
 */
export function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {children.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium tabular-nums text-fg-primary"
          >
            {i + 1}
          </span>
          <span className="min-w-0 break-words text-[15px] leading-6 text-fg-primary">{step}</span>
        </li>
      ))}
    </ol>
  );
}
