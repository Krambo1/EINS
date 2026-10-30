import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import type { MetricDelta } from "@/server/queries/admin";

/**
 * Admin surface: a flat panel with a hairline border (no shadow) and a dense
 * header row (title, muted count, quiet link or control on the right). Every
 * block on the Übersicht uses this, so spacing and title size match. No
 * description line: the title and the rows have to say it.
 */
export function Panel({
  title,
  count,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  /** Muted number right after the title (rows in the list, open items). */
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-md border border-border bg-[var(--surface-tile)] print:break-inside-avoid",
        className
      )}
    >
      <header className="px-4 pt-3">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="flex min-w-0 items-baseline gap-2 text-[15px] font-semibold text-fg-primary">
            {title}
            {count != null && (
              <span className="text-sm font-normal tabular-nums text-fg-secondary">{count}</span>
            )}
          </h2>
          {/* No ml-auto: on the phone a wide control wraps under the title
              and starts at the left edge instead of hanging off the right. */}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </header>
      <div className={cn("px-4 pb-4 pt-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Quiet text link for a panel header ("Alle ansehen"). */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 rounded text-[13px] text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/**
 * Class for one list row inside a panel. `data-row` on the element makes it
 * a stop for J/K in the admin shell; Enter then opens the focused link.
 */
export const ROW_CLASS =
  "-mx-2 flex min-h-10 items-center gap-3 rounded px-2 py-2 text-sm transition-colors hover:bg-bg-secondary focus-visible:bg-bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent";

/**
 * Change against the period before as coloured text (value is in percent).
 * No change or no comparison, no text: callers check before rendering.
 */
export function AdminDelta({ delta }: { delta: MetricDelta }) {
  if (delta.suppressed || Math.abs(delta.value) < 0.05) return null;
  const Icon = delta.value > 0 ? ArrowUpRight : ArrowDownRight;
  const abs = Math.abs(delta.value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-medium tabular-nums",
        delta.tone === "good" && "text-tone-good",
        delta.tone === "bad" && "text-tone-bad",
        (delta.tone === "neutral" || delta.tone === "warn") && "text-fg-secondary"
      )}
      title="vs. Vormonat"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {abs.toFixed(abs >= 10 ? 0 : 1).replace(".", ",")} %
    </span>
  );
}
