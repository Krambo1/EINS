import type { ReactNode } from "react";
import { cn } from "@eins/ui";

/** Title of a Praxis page: one size on every page, no trailing period. */
export const PAGE_TITLE = "text-2xl font-semibold leading-8 tracking-tight text-fg-primary";

/**
 * A Praxis page's first row, like the title row of Stripe's lists: the title
 * on the left, the page's one action on the right. From md it is as tall as
 * the shell row (`--shell-row`), so it lines up with the logo row of the
 * sidebar. No subtitle: the nav already says where we are and what the page
 * is for.
 */
export function PageHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  /** Right side: the page's primary action. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-[var(--control-h)] items-center justify-between gap-3 md:min-h-[var(--shell-row)]",
        className
      )}
    >
      <h1 className={cn("min-w-0 break-words", PAGE_TITLE)}>{title}</h1>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
