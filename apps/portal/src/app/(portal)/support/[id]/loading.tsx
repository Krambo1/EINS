import { Button, cn } from "@eins/ui";
import { PRIMARY_BUTTON } from "../../einstellungen/_components/settings-ui";
import { SKELETON_BAR } from "../../einstellungen/_lib/sizes";
import { SupportHead } from "../_components/SupportHead";
import { PRIVACY_NOTE } from "../_lib/labels";
import { PAGE_WIDTH, REPLY_HEIGHT, TEXT_AREA, THREAD_CARD, THREAD_PAGE_HEIGHT } from "../_lib/sizes";

/** Body lines of the three placeholder messages. */
const MESSAGES = [["w-full", "w-4/5"], ["w-full", "w-full", "w-2/3"], ["w-3/4"]];

/**
 * A conversation while it loads: the head with the way back, the card at
 * its height, three messages and the answer field at the foot, so nothing
 * moves when the messages arrive. For the Kundenansicht the field stands in
 * until the sentence takes its place.
 */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Unterhaltung wird geladen"
      className={cn(PAGE_WIDTH, "flex flex-col gap-4 md:gap-6", THREAD_PAGE_HEIGHT)}
    >
      <SupportHead
        title={<span className={cn(SKELETON_BAR, "inline-block h-6 w-56 max-w-full align-middle")} />}
        actions={<span className={cn(SKELETON_BAR, "h-3.5 w-16")} />}
      />
      <section className={THREAD_CARD}>
        <ol className="min-h-0 flex-1 divide-y divide-border overflow-hidden px-5 py-1 md:px-6 md:py-2">
          {MESSAGES.map((lines, i) => (
            <li key={i} className="py-4">
              <div className="flex h-6 items-center justify-between gap-3">
                <span className={cn(SKELETON_BAR, "h-4 w-24")} />
                <span className={cn(SKELETON_BAR, "h-3.5 w-28")} />
              </div>
              <div className="mt-1">
                {lines.map((w, j) => (
                  <div key={j} className="flex h-6 items-center">
                    <span className={cn(SKELETON_BAR, "h-3.5", w)} />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-border px-5 py-4 md:px-6">
          <div className={cn(TEXT_AREA, REPLY_HEIGHT)} />
          <div className="mt-3 flex items-start justify-between gap-3">
            <p className="flex min-h-[var(--control-h)] min-w-0 items-center text-sm leading-5 text-fg-secondary">{PRIVACY_NOTE}</p>
            <Button disabled className={cn(PRIMARY_BUTTON, "shrink-0")}>
              Senden
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
