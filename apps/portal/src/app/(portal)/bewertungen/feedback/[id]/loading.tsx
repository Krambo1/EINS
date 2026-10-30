import { ArrowLeft } from "lucide-react";
import { cn } from "@eins/ui";
import { CONTROL, CONTROL_SQUARE, DashCard, QUIET_CONTROL } from "../../../dashboard/_components/dash-ui";
import { DETAIL_GRID, DETAIL_TEXT_HEIGHT, FACT_COLUMNS, NOTE_HEIGHT, RECORD_NAME_HEIGHT } from "../../_lib/sizes";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED = "elev-raised rounded-[var(--r-control)] bg-[var(--surface-raised)]";
const WELL = "elev-inset rounded-[var(--r-panel)] bg-[var(--well)]";
const CARD =
  "anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6";
const FACTS = ["Status", "Erledigt", "Eingang", "Anlass", "E-Mail", "Rückruf", "Weg"];

/**
 * The Rückmeldung while it loads: the same rows, cards and wells at the
 * same sizes (the constants in _lib/sizes.ts), so nothing moves when it
 * arrives. The Bearbeiten card stands for every role; who may not edit sees
 * it go when the page is there.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" aria-label="Rückmeldung wird geladen">
      <div className="mb-4 flex h-[var(--track-h)] items-center justify-between gap-3 md:mb-6">
        <span className={cn(QUIET_CONTROL, "-ml-2.5")}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Alle Rückmeldungen
        </span>
        <div className="flex items-center gap-2">
          <span className={cn(RAISED, CONTROL, CONTROL_SQUARE)} />
          <span className={cn(RAISED, CONTROL, CONTROL_SQUARE)} />
        </div>
      </div>

      <div className={DETAIL_GRID}>
        <section className={cn(CARD, "xl:col-start-2 xl:row-span-2 xl:row-start-1")}>
          <div className={cn("flex", RECORD_NAME_HEIGHT)}>
            <span className={cn(BAR, "mt-auto h-7 w-48")} />
          </div>
          <div className="mt-2 flex h-6 items-center">
            <span className={cn(BAR, "h-4 w-32")} />
          </div>
          <div className={cn("mt-4 h-[var(--control-h)]", RAISED)} />
          <dl className="mt-4 divide-y divide-border border-t border-border">
            {FACTS.map((label) => (
              <div key={label} className={cn("grid min-h-11 items-start gap-3 py-3", FACT_COLUMNS)}>
                <dt className="text-sm leading-5 text-fg-secondary">{label}</dt>
                <dd className={label === "Erledigt" ? "h-10" : "h-5"}>
                  <span className={cn(BAR, "block h-4 w-28")} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <DashCard title="Rückmeldung" className="xl:col-start-1 xl:row-start-1">
          <div className={cn(WELL, DETAIL_TEXT_HEIGHT)} />
        </DashCard>

        <DashCard title="Bearbeiten" className="xl:col-start-1 xl:row-start-2">
          <p className="mb-2 text-sm font-medium leading-5 text-fg-primary">Status</p>
          <div className={cn(WELL, "grid grid-cols-2 gap-1 p-1 sm:grid-cols-4")}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cn("h-[var(--control-h)]", i === 0 && RAISED)} />
            ))}
          </div>
          <div className="mt-5">
            <div className="flex h-[var(--control-h)] items-center justify-between gap-3">
              <span className="text-sm font-medium leading-5 text-fg-primary">Interne Notiz</span>
              <span className={cn(RAISED, CONTROL, "w-40")} />
            </div>
            <div className={cn(WELL, "mt-2", NOTE_HEIGHT)} />
            <div className="mt-3 flex h-[var(--control-h)] items-center justify-end">
              <span className={cn(CONTROL, "w-36 bg-[var(--well)]")} />
            </div>
          </div>
        </DashCard>
      </div>
    </div>
  );
}
