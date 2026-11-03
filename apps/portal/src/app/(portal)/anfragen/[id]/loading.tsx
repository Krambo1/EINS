import { ArrowLeft, ChevronDown } from "lucide-react";
import { cn } from "@eins/ui";
import {
  CONTROL,
  DashCard,
  QUIET_CONTROL,
} from "../../dashboard/_components/dash-ui";
import {
  COMPOSER_HEIGHT,
  DETAIL_GRID,
  FACT_COLUMNS,
  MESSAGE_HEIGHT,
  ORDER,
  RECORD_NAME_HEIGHT,
  VERLAUF_HEIGHT,
  detailColumns,
} from "./_lib/sizes";

/** The Bearbeiten card is drawn, so the record lines up with it as on the page. */
const COLUMNS = detailColumns(true);
const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED =
  "elev-raised rounded-[var(--r-control)] bg-[var(--surface-raised)]";
const WELL = "elev-inset rounded-[var(--r-panel)] bg-[var(--well)]";
const CARD =
  "anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6";
/** The record's rows with their line count, as the page renders them (without the PVS row). */
const FACTS: Array<[string, 1 | 2]> = [
  ["Telefon", 1],
  ["E-Mail", 1],
  ["Status", 1],
  ["Frist", 2],
  ["Wiedervorlage", 2],
  ["Behandlung", 1],
  ["Quelle", 2],
  ["Standort", 1],
  ["Eingang", 1],
];

/**
 * The Anfrage while it loads: the same cards, rows and wells at the same
 * sizes (the constants in _lib/sizes.ts), so nothing moves when it arrives.
 * The Bearbeiten card stands for every role; who may not work the Anfrage
 * sees it go when the page is there. Wiederbehandlung and Weitere Anfragen
 * exist only for some patients and are not drawn.
 */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Anfrage wird geladen"
      className="pb-24 md:pb-0"
    >
      <div className="mb-4 flex h-[var(--track-h)] items-center md:mb-6">
        <span className={cn(QUIET_CONTROL, "-ml-2.5")}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Alle Anfragen
        </span>
      </div>

      <div className={DETAIL_GRID}>
        <div className={COLUMNS.recordTop}>
          <section
            aria-label="Angaben zur Anfrage"
            className={cn(CARD, ORDER.record)}
          >
            <div className={cn("flex", RECORD_NAME_HEIGHT)}>
              <span className={cn(BAR, "mt-auto h-7 w-48")} />
            </div>
            <div className={cn("mt-4 hidden md:block", CONTROL, RAISED)} />
            <dl className="mt-4 divide-y divide-border border-t border-border">
              {FACTS.map(([label, lines]) => (
                <div
                  key={label}
                  className={cn(
                    "grid min-h-11 items-start gap-3 py-3",
                    FACT_COLUMNS,
                  )}
                >
                  <dt className="text-sm leading-5 text-fg-secondary">
                    {label}
                  </dt>
                  <dd className={lines === 2 ? "h-10" : "h-5"}>
                    <span className={cn(BAR, "block h-4 w-32")} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <div className={COLUMNS.workTop}>
          <DashCard title="Nachricht" className={ORDER.message}>
            <div className={cn(WELL, MESSAGE_HEIGHT)} />
          </DashCard>

          <DashCard title="Bearbeiten" className={ORDER.work}>
            <p className="mb-2 text-[15px] font-medium text-fg-primary">
              Ergebnis des Anrufs
            </p>
            <div
              className={cn(
                WELL,
                "grid grid-cols-3 gap-1 p-1 sm:inline-grid sm:grid-cols-[repeat(3,auto)]",
              )}
            >
              {["Termin vereinbart", "Erreicht", "Nicht erreicht"].map((l) => (
                <span
                  key={l}
                  className="flex h-[var(--control-h)] items-center justify-center px-2 text-center text-sm font-medium leading-tight text-fg-secondary sm:px-3.5"
                >
                  {l}
                </span>
              ))}
            </div>
            <div className="my-5 border-t border-border" />
            <div
              className={cn(
                WELL,
                "grid h-[calc(var(--control-h)+0.5rem)] grid-cols-3 gap-1 p-1",
              )}
            >
              {["Notiz", "Nachricht", "Wiedervorlage"].map((l, i) => (
                <span
                  key={l}
                  className={cn(
                    "flex h-full items-center justify-center px-3 text-sm font-medium",
                    i === 0
                      ? cn(RAISED, "text-fg-primary")
                      : "text-fg-secondary",
                  )}
                >
                  {l}
                </span>
              ))}
            </div>
            <div className={cn(WELL, "mt-3", COMPOSER_HEIGHT)} />
            <div className="mt-3 flex h-[var(--control-h)] items-center justify-end">
              <span className={cn(CONTROL, "w-28 bg-[var(--well)]")} />
            </div>
          </DashCard>
        </div>

        <div className={COLUMNS.workRest}>
          <DashCard title="Verlauf" className={ORDER.verlauf}>
            <div className={cn("space-y-5 pt-3", VERLAUF_HEIGHT)}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
                >
                  <span className={cn(BAR, "mt-0.5 h-4 w-4")} />
                  <span className="space-y-2">
                    <span className={cn(BAR, "block h-4 w-40")} />
                    <span className={cn(BAR, "block h-3.5 w-24")} />
                  </span>
                </div>
              ))}
            </div>
          </DashCard>

          <section
            aria-label="Details"
            className={cn(
              CARD,
              ORDER.details,
              "flex items-center justify-between gap-3",
            )}
          >
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-5 text-fg-primary">
                Details
              </span>
              <span className="mt-1 block text-sm leading-5 text-fg-secondary">
                Frist und Kontakt, Einwilligungen, Kennungen
              </span>
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-fg-secondary"
              aria-hidden
            />
          </section>
        </div>
      </div>
    </div>
  );
}
