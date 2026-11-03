import { StatusPill, cn } from "@eins/ui";
import { TABLE_ROW, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { CALL_CARD_HEIGHT, QUEUE_LIST_HEIGHT, QUEUE_ROW_HEIGHT, QUEUE_SLOTS } from "./CallQueue";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const CARD = "elev-card rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6";

/**
 * Fallback für die gestreamte Anfragen-Liste: dieselben Karten wie die
 * fertige Seite (auf Wunsch die zwei Anruf-Karten, dann die Liste mit
 * Kopf-Band und Zeilen), ohne Header und Filter, da diese
 * in eigenen Suspense-Grenzen bzw. synchron rendern.
 */
export function RequestListSkeleton({ callQueue = false }: { callQueue?: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Anfragen werden geladen"
      className="space-y-4 md:space-y-6"
    >
      {callQueue && <CallQueueSkeleton />}
      <section className={cn(CARD, "flex flex-col")}>
        <div className="flex h-[var(--control-h)] items-center justify-between">
          <div className={cn(BAR, "h-4 w-36")} />
          <div className="elev-raised h-[var(--control-h)] w-20 rounded-[var(--r-control)] bg-[var(--surface-raised)] sm:w-48" />
        </div>
        <div className="mt-4">
          <div className={cn("elev-inset hidden h-8 rounded-[var(--r-control)] bg-[var(--well)] min-[1100px]:block", WASH_AREA)} />
          <ul className="divide-y divide-border">
            {/* A full page (PAGE_SIZE in page.tsx): every page of a longer
                list has this height, the last one filled up. Each row has
                the shape of the page's filler rows, so it is as tall as a
                real one. */}
            {Array.from({ length: 25 }).map((_, i) => (
              <li key={i} className={WASH_ROW}>
                <div className={cn(TABLE_ROW, "flex items-start gap-2.5 py-3 min-[1100px]:min-h-9 min-[1100px]:items-center min-[1100px]:py-2", WASH_AREA)}>
                  <span className="h-5 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex h-5 items-center">
                      <div className={cn(BAR, "h-4 w-40")} />
                    </div>
                    {/* The status sets the line's height, as in a real row. */}
                    <span className="mt-1 flex min-w-0 items-center text-sm leading-5 min-[1100px]:hidden">
                      <span aria-hidden className="invisible w-0 overflow-hidden">
                        <StatusPill status="neu" />
                      </span>
                      <span className={cn(BAR, "h-3.5 w-56 max-w-full")} />
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {/* "Seite 1 von N" with Zurück and Weiter, as on every page of a
            longer list. */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className={cn(BAR, "h-4 w-28")} />
          <div className="flex gap-2">
            <div className="elev-raised h-[var(--control-h)] w-24 rounded-[var(--r-control)] bg-[var(--surface-raised)]" />
            <div className="elev-raised h-[var(--control-h)] w-24 rounded-[var(--r-control)] bg-[var(--surface-raised)]" />
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The two call cards at their fixed heights (CALL_CARD_HEIGHT, QUEUE_SLOTS
 * rows), so the page does not move when the real cards stream in.
 */
function CallQueueSkeleton() {
  return (
    <div className="grid gap-4 md:gap-6 xl:grid-cols-2">
      <section className={cn(CARD, "flex flex-col", CALL_CARD_HEIGHT)}>
        <div className="flex h-6 items-center justify-between">
          <div className={cn(BAR, "h-4 w-28")} />
          <div className={cn(BAR, "h-4 w-24")} />
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 items-center">
            <div className={cn(BAR, "h-6 w-48")} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
            <div className="col-span-2 h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-inset)] sm:w-32" />
            <div className="elev-raised h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)] sm:w-32" />
            <div className="elev-raised h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)] sm:w-28" />
          </div>
          <div className="mt-5 space-y-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex h-5 items-center gap-4">
                <div className={cn(BAR, "h-3.5 w-[6.5rem]")} />
                <div className={cn(BAR, "h-3.5 w-32")} />
              </div>
            ))}
          </div>
          <div className="elev-inset mt-5 min-h-0 flex-1 rounded-[var(--r-panel)] bg-[var(--well)]" />
          <div className="pt-5">
            <div className="border-t border-border pt-4">
              <div className="flex h-[1.375rem] items-center">
                <div className={cn(BAR, "h-4 w-36")} />
              </div>
              <div className="elev-inset mt-2 h-[var(--track-h)] rounded-[var(--r-panel)] bg-[var(--well)] sm:w-[26rem]" />
            </div>
          </div>
        </div>
      </section>
      <section className={cn(CARD, "flex flex-col")}>
        <div className="flex h-6 items-center justify-between">
          <div className={cn(BAR, "h-4 w-24")} />
          <div className={cn(BAR, "h-4 w-20")} />
        </div>
        <ul className={cn("-mx-3 mt-4 divide-y divide-border px-3", QUEUE_LIST_HEIGHT)}>
          {Array.from({ length: QUEUE_SLOTS }).map((_, i) => (
            <li key={i} className={WASH_ROW}>
              <div className={cn("flex items-center gap-3 py-3", WASH_AREA, QUEUE_ROW_HEIGHT)}>
                <span className="w-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className={cn(BAR, "h-4 w-36")} />
                  <div className={cn(BAR, "h-3.5 w-48 max-w-full")} />
                </div>
                <div className="elev-raised h-[var(--control-h)] w-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--surface-raised)]" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
