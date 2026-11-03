import { AnfragenFiltersSkeleton } from "../_components/AnfragenFilters";
import { RequestListSkeleton } from "../_components/RequestListSkeleton";
import { PAGE_TITLE } from "../../_components/PageHeader";
import { cn } from "@eins/ui";

/**
 * Same shape as the page: on the phone the title row, from md the toolbar
 * as the first row, then the call cards, Wiederbehandlungen and the list.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-4 flex min-h-[var(--control-h)] items-center justify-between gap-3 md:hidden">
        <h1 className={cn("min-w-0", PAGE_TITLE)}>Anfragen</h1>
        <div className="elev-raised h-[var(--control-h)] w-44 shrink-0 rounded-[var(--r-control)] bg-[var(--surface-raised)]" />
      </div>
      <div className="space-y-4 md:space-y-6">
        <AnfragenFiltersSkeleton canCreate />
        {/* Opened from the nav, the page has no filters: the call cards and
            Wiederbehandlungen come. */}
        <RequestListSkeleton callQueue />
      </div>
    </div>
  );
}
