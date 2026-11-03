import { cn } from "@eins/ui";
import { DONE_CARD_HEIGHT, DONE_PLACE, GRID, PLAN_CARD_HEIGHT } from "../_lib/sizes";
import type { FortschrittView } from "../_lib/steps";
import { StepCard } from "./StepCard";

/**
 * The three cards of the page: what EINS does now, what comes next, what is
 * done. Each keeps its height and its empty sentence, so the page looks the
 * same on day one, mid-journey and after the 90 days.
 */
export function TimelineList({ view }: { view: FortschrittView }) {
  return (
    <div className={GRID}>
      <StepCard
        id="in-arbeit"
        state="laeuft"
        title="In Arbeit"
        rows={view.active}
        empty="Gerade läuft nichts."
        className={PLAN_CARD_HEIGHT}
      />
      <StepCard
        id="als-naechstes"
        state="geplant"
        title="Als Nächstes"
        rows={view.upcoming}
        empty="Nichts weiter geplant."
        className={cn(PLAN_CARD_HEIGHT, "[--delay:40ms]")}
      />
      <StepCard
        id="erledigt"
        state="abgeschlossen"
        title="Erledigt"
        rows={view.done}
        empty="Noch nichts erledigt."
        className={cn(DONE_CARD_HEIGHT, DONE_PLACE, "[--delay:80ms]")}
      />
    </div>
  );
}
