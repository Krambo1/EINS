import type { ReactNode } from "react";
import { cn } from "@eins/ui";
import { PAGE_TITLE } from "../../_components/PageHeader";

/**
 * Sizes shared by the page and `loading.tsx`, so the skeleton has the page's
 * shape and every closed question its height (DESIGN.md section 10).
 */

/** Gap between the head and the cards and between the cards. */
export const STACK = "space-y-4 md:space-y-6";

/**
 * The question inside its row (`WASH_ROW` on the `li`, `WASH_AREA` across):
 * 12 px between the text and the wash's edge, at least 48 px high, so a
 * one-line question is 56 px between the hairlines. Long questions wrap,
 * never cut.
 */
export const QUESTION_BOX = "min-h-12 py-3";

/** The search: full width under the title on the phone, at most 24rem at the end of the title row from md. */
export const SEARCH_SLOT = "relative w-full md:w-auto md:min-w-0 md:max-w-sm md:flex-1";

/**
 * The page's first row, Dateien's `PageHeader` with the search as its one
 * control: from md "Hilfe" on the logo row and the search at its right end
 * (the search in the head of Stripe Support's topic pages), so the first card
 * stays level with the nav. On the phone the search wraps to a row of its own
 * under the title, Stripe Support's order.
 */
export function HilfeHead({ search }: { search: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-4 md:min-h-[var(--shell-row)] md:flex-nowrap">
      <h1 className={cn("flex min-h-[var(--control-h)] items-center", PAGE_TITLE)}>Hilfe</h1>
      {search}
    </header>
  );
}
