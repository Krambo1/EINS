import { cn } from "@eins/ui";
import { DashCard, WASH_ROW } from "../dashboard/_components/dash-ui";
import { PageHeader } from "../_components/PageHeader";
import { StepTitle, type StepState } from "./_components/StepGlyph";
import {
  DONE_CARD_HEIGHT,
  DONE_PLACE,
  DONE_SLOTS,
  GRID,
  PLAN_CARD_HEIGHT,
  PLAN_SLOTS,
  SKELETON_BAR,
  STEP_BOX,
  STEP_LIST,
} from "./_lib/sizes";

/**
 * Same frame as the page: the title row, the three cards at their fixed
 * heights with their step slots, so nothing moves when the steps arrive.
 */
export default function Loading() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader title="Fortschritt" />
      <div className={GRID}>
        <SkeletonCard state="laeuft" title="In Arbeit" slots={PLAN_SLOTS} className={PLAN_CARD_HEIGHT} />
        <SkeletonCard state="geplant" title="Als Nächstes" slots={PLAN_SLOTS} className={PLAN_CARD_HEIGHT} />
        <SkeletonCard
          state="abgeschlossen"
          title="Erledigt"
          slots={DONE_SLOTS}
          className={cn(DONE_CARD_HEIGHT, DONE_PLACE)}
        />
      </div>
    </div>
  );
}

function SkeletonCard({
  state,
  title,
  slots,
  className,
}: {
  state: StepState;
  title: string;
  slots: number;
  className: string;
}) {
  return (
    <DashCard
      title={<StepTitle state={state}>{title}</StepTitle>}
      className={cn("flex flex-col", className)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {/* No scrolling in the skeleton: rows past the card's room are cut. */}
      <ul className={cn(STEP_LIST, "overflow-hidden")}>
        {Array.from({ length: slots }).map((_, i) => (
          // The 4 px white inside the hairlines as on the page; the slot sits where the row's text does.
          <li key={i} className={WASH_ROW}>
            <div className={STEP_BOX}>
            <span className="min-w-0 flex-1">
              <span className="flex h-5 items-center">
                <span className={cn(SKELETON_BAR, "h-4 w-56 max-w-full")} />
              </span>
              <span className="mt-1 flex h-5 items-center">
                <span className={cn(SKELETON_BAR, "h-3.5 w-32 max-w-full")} />
              </span>
            </span>
            <span aria-hidden className="h-5 w-5 shrink-0" />
            </div>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}
