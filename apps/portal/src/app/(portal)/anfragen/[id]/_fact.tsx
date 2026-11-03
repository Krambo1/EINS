import type { ReactNode } from "react";
import { cn } from "@eins/ui";
import { FACT_COLUMNS } from "./_lib/sizes";

/**
 * One fact of the record: label left, value right (Attio's record details,
 * the Rückmeldung's `Fact`). The value has a fixed height of one or two
 * lines, so a long e-mail, a missing number or a save never changes a row:
 * one-line values scroll sideways instead of being cut with "…". `wrap` lets
 * a two-line value break into its second line (the Frist's contract wording).
 * Usable from server and client components alike.
 */
export function Fact({
  label,
  lines = 1,
  scroll = true,
  wrap = false,
  columns = FACT_COLUMNS,
  children,
}: {
  label: ReactNode;
  lines?: 1 | 2;
  scroll?: boolean;
  wrap?: boolean;
  columns?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-h-11 items-start gap-3 py-3", columns)}>
      <dt className="text-sm leading-5 text-fg-secondary">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-[15px] leading-5 text-fg-primary",
          wrap ? "overflow-hidden break-words" : "whitespace-nowrap",
          lines === 2 ? "h-10" : "h-5",
          scroll && !wrap && "scroll-shadows-x"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** A value that is missing, said in grey ("Keine Telefonnummer"). */
export function Missing({ children }: { children: ReactNode }) {
  return <span className="text-fg-secondary">{children}</span>;
}

/** Icon button inside a record row (Attio's copy on a field): 28 px, quiet. */
export const ROW_ICON_BUTTON =
  "-my-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-small)] text-fg-secondary transition-colors hover:bg-[var(--hover-wash)] hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
