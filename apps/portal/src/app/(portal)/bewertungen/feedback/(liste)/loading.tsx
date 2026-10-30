import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@eins/ui";
import { PageHeader } from "../../../_components/PageHeader";
import { CARD_TITLE, CONTROL } from "../../../dashboard/_components/dash-ui";
import { BewertungenTabsSkeleton } from "../../_components/BewertungenTabs";
import { FEEDBACK_VIEWS, FEEDBACK_VIEW_LABELS } from "../../_lib/feedback-filter";
import { FEEDBACK_BODY_HEIGHT, FEEDBACK_PAGE_SIZE, FEEDBACK_ROW_HEIGHT } from "../../_lib/sizes";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED = "elev-raised bg-[var(--surface-raised)]";

/**
 * The Patientenfeedback tab while it loads: the same header, chips, ten
 * row slots and pager at the same sizes (FeedbackList and _lib/sizes.ts),
 * so nothing moves when the rows arrive. It sits in the route group (liste),
 * so it wraps the list only and a Rückmeldung ([id]) keeps its own skeleton,
 * also on a full page load (see the note in (plattformen)/loading.tsx).
 */
export default function Loading() {
  return (
    <>
      <PageHeader title="Bewertungen" className="mb-4 md:sr-only" />
      <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite" aria-label="Rückmeldungen werden geladen">
        <BewertungenTabsSkeleton active={1} />

        <section className="anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={CARD_TITLE}>Rückmeldungen</h2>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className={cn(CONTROL, "elev-inset relative min-w-0 flex-1 bg-[var(--well)] sm:w-60 sm:flex-none")}>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" aria-hidden />
              </div>
              <div className={cn(CONTROL, "inline-flex shrink-0 items-center gap-1.5 border border-dashed border-[var(--border-hover)] px-3 text-sm font-medium text-fg-secondary")}>
                <span className="inline-grid">
                  {/* The longest label sets the width, as on the real trigger. */}
                  <span className="col-start-1 row-start-1 whitespace-nowrap">Alle Sterne</span>
                  <span className="invisible col-start-1 row-start-1 whitespace-nowrap">4-5 Sterne</span>
                </span>
                <ChevronDown className="h-4 w-4" aria-hidden />
              </div>
            </div>
          </header>

          <ul className="mt-4 flex flex-wrap gap-2">
            {FEEDBACK_VIEWS.map((v, i) => (
              <li
                key={v}
                className={cn(
                  CONTROL,
                  "inline-flex items-center gap-2 border px-3 text-sm font-medium",
                  i === 0 ? cn(RAISED, "border-transparent text-fg-primary") : "border-border text-fg-secondary"
                )}
              >
                {FEEDBACK_VIEW_LABELS[v]}
                <span className="min-w-[3ch]" />
              </li>
            ))}
          </ul>

          <div className="-mx-2 mt-4">
            <ul className={cn("divide-y divide-border overflow-hidden", FEEDBACK_BODY_HEIGHT)}>
              {Array.from({ length: FEEDBACK_PAGE_SIZE }, (_, i) => (
                <li key={i} className={cn("flex items-start gap-2.5 px-2 py-2.5", FEEDBACK_ROW_HEIGHT)}>
                  <span className="h-5 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex h-5 items-center justify-between gap-3">
                      <span className={cn(BAR, "h-4 w-44")} />
                      <span className={cn(BAR, "h-3.5 w-20")} />
                    </span>
                    <span className="mt-1 flex h-5 items-center">
                      <span className={cn(BAR, "h-3.5 w-40")} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <footer className="mt-4 flex h-[var(--control-h)] items-center justify-between gap-3">
            <span className={cn(BAR, "h-3.5 w-24")} />
            <div className="flex items-center gap-2">
              <span className={cn(CONTROL, RAISED, "inline-flex items-center gap-2 px-3 text-sm font-medium text-fg-tertiary")}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Zurück
              </span>
              <span className={cn(CONTROL, RAISED, "inline-flex items-center gap-2 px-3 text-sm font-medium text-fg-tertiary")}>
                Weiter
                <ChevronRight className="h-4 w-4" aria-hidden />
              </span>
            </div>
          </footer>
        </section>
      </div>
    </>
  );
}
