import { cn } from "@eins/ui";
import { DashCard, WASH_ROW } from "../dashboard/_components/dash-ui";
import { FAQ_CATEGORIES } from "./content";
import { HilfeHead, QUESTION_BOX, SEARCH_SLOT, STACK } from "./_components/parts";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-inset)]";

/**
 * The page's frame (FaqBrowser): the head with the search slot, then every
 * topic card with its title and one slot per question. Each slot holds its
 * question unseen, so it takes the question's real height at every width
 * (a long one wraps to three lines on the phone) and nothing moves when the
 * page arrives.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <HilfeHead search={<span className={cn(SEARCH_SLOT, FIELD_SLOT)} />} />
      {FAQ_CATEGORIES.map((cat) => (
        <DashCard key={cat.id} title={cat.label}>
          <ul className="divide-y divide-border">
            {cat.items.map((item) => (
              // The hairline and the white 4 px sit on the li, the question box inside, as on the page.
              <li key={item.id} className={WASH_ROW}>
                <div className={cn("relative flex items-center gap-3", QUESTION_BOX)}>
                  {/* A button resets the body's word spacing; the slot does too, so it wraps where the question does. */}
                  <span className="invisible min-w-0 flex-1 break-words text-[15px] font-medium leading-5 [word-spacing:normal]">
                    {item.q}
                  </span>
                  <span className="h-4 w-4 shrink-0" />
                  <span
                    className={cn(BAR, "absolute left-0 top-1/2 h-4 -translate-y-1/2")}
                    style={{ width: `min(${Math.round(item.q.length * 0.45)}rem, calc(100% - 1.75rem))` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </DashCard>
      ))}
    </div>
  );
}
