import { cn } from "@eins/ui";
import { DashCard, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { OnboardingHead } from "../_components/OnboardingHead";
import { GATE_LINE, LIST_BODY, ONBOARDING_PAGE, ROW_LIST, SKELETON_BAR, STEP_ROW, TITLED_LIST_BODY } from "../_lib/sizes";

/**
 * Same frame as the page while the portal is still locked: the title row,
 * the gate line and the four step rows, then "Erst für Anzeigen" with its
 * one row, so nothing moves when the steps arrive.
 */
export default function Loading() {
  return (
    <div className={ONBOARDING_PAGE} aria-busy="true" aria-live="polite">
      <OnboardingHead title="Erste Schritte" count={<span className={cn(SKELETON_BAR, "block h-4 w-28")} />} />
      <DashCard bodyClassName={LIST_BODY}>
        <div className={GATE_LINE}>
          <span className="flex h-6 items-center">
            <span className={cn(SKELETON_BAR, "h-4 w-full lg:w-[36rem] lg:max-w-full")} />
          </span>
          <span className="flex h-6 items-center lg:hidden">
            <span className={cn(SKELETON_BAR, "h-4 w-40")} />
          </span>
        </div>
        <ol className={cn(ROW_LIST, "border-t border-border")}>
          {/* As many rows as the page has steps. */}
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className={WASH_ROW}>
              <SkeletonRow />
            </li>
          ))}
        </ol>
      </DashCard>
      <DashCard title="Erst für Anzeigen" className="[--delay:40ms]" bodyClassName={TITLED_LIST_BODY}>
        <ul className={ROW_LIST}>
          <li className={WASH_ROW}>
            <SkeletonRow />
          </li>
        </ul>
      </DashCard>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className={cn(STEP_ROW, "hover:bg-transparent")}>
      <span className="min-w-0 flex-1">
        <span className="flex h-5 items-center">
          <span className={cn(SKELETON_BAR, "h-4 w-48 max-w-full")} />
        </span>
        <span className="mt-1 flex h-5 items-center">
          <span className={cn(SKELETON_BAR, "h-3.5 w-40 max-w-full")} />
        </span>
      </span>
      <span aria-hidden className="h-5 w-5 shrink-0" />
    </div>
  );
}
