import { cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { DashCard, TABLE_HEAD_BAND, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { BewertungenTabsSkeleton } from "../_components/BewertungenTabs";
import { ReplyTemplatesCard } from "../_components/ReplyTemplatesCard";
import {
  FEEDBACK_ROW_HEIGHT,
  HISTORY_BODY_HEIGHT,
  NEW_FEEDBACK_SLOTS,
  TOP_CARD_HEIGHT,
  TOP_FEEDBACK_SPAN,
  TOP_GRID,
} from "../_lib/sizes";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED = "elev-raised h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)]";

/**
 * The Plattformen tab while it loads: the same cards at the same heights
 * (the constants in _lib/sizes.ts), so nothing moves when the data arrives.
 * The Antwortvorlagen need no data and stand as themselves.
 * It sits in the route group (plattformen), so it wraps this page only: a
 * loading file in bewertungen/ also wrapped feedback/, and a reload of the
 * list or a Rückmeldung showed these cards first (Next shows the outermost
 * loading file on a full page load).
 */
export default function Loading() {
  return (
    <>
      <PageHeader title="Bewertungen" className="mb-4 md:sr-only" />
      <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite" aria-label="Bewertungen werden geladen">
        <BewertungenTabsSkeleton active={0} />

        <div className={TOP_GRID}>
          <DashCard
            title={<span className={cn(BAR, "inline-block h-4 w-48 align-middle")} />}
            className={cn("flex flex-col", TOP_CARD_HEIGHT, TOP_FEEDBACK_SPAN)}
            bodyClassName="flex min-h-0 flex-1 flex-col"
          >
            <ul className="-mx-3 min-h-0 flex-1 divide-y divide-border overflow-hidden px-3">
              {Array.from({ length: NEW_FEEDBACK_SLOTS }, (_, i) => (
                <li key={i} className={WASH_ROW}>
                  <span className={cn("flex items-start gap-2.5 py-3", WASH_AREA, FEEDBACK_ROW_HEIGHT)}>
                    <span className="h-5 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex h-5 items-center">
                        <span className={cn(BAR, "h-4 w-40")} />
                      </span>
                      <span className="mt-1 flex h-5 items-center">
                        <span className={cn(BAR, "h-3.5 w-20")} />
                      </span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 h-5 shrink-0" />
          </DashCard>
          {[0, 1].map((i) => (
            <DashCard
              key={i}
              title={<span className={cn(BAR, "inline-block h-4 w-24 align-middle")} />}
              className={cn("flex flex-col", TOP_CARD_HEIGHT)}
              bodyClassName="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex h-10 items-center">
                <span className={cn(BAR, "h-8 w-32")} />
              </div>
              <div className="mt-1 flex h-5 items-center">
                <span className={cn(BAR, "h-3.5 w-52 max-w-full")} />
              </div>
              <div className="mt-0.5 flex h-5 items-center">
                <span className={cn(BAR, "h-3.5 w-28")} />
              </div>
              <div className="mt-4 flex min-h-0 flex-1 items-end">
                <div className="flex h-16 w-full items-end">
                  <span className="block h-0.5 w-full rounded-full bg-[var(--well)]" />
                </div>
              </div>
              <div className="mt-4 grid shrink-0 grid-cols-2 gap-2">
                <div className={RAISED} />
                <div className={RAISED} />
              </div>
            </DashCard>
          ))}
        </div>

        <ReplyTemplatesCard />

        <DashCard title={<span className={cn(BAR, "inline-block h-4 w-20 align-middle")} />}>
          <div className="-mx-3">
            <div className={cn(TABLE_HEAD_BAND)} />
            <div className={cn("mt-1", HISTORY_BODY_HEIGHT)} />
          </div>
        </DashCard>
      </div>
    </>
  );
}
