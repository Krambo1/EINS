import { cn } from "@eins/ui";
import { DashCard, TABLE_HEAD_BAND, WASH_ROW } from "../dashboard/_components/dash-ui";
import { PageHeader } from "../_components/PageHeader";
import { LEITFADEN_PAGE } from "./content";
import { cardsOf } from "./_lib/cards";
import { SECTIONS } from "./_lib/sections";
import { COLUMNS, GROUP_GAP, PDF_WIDTH, ROW, STACK } from "./_lib/sizes";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED_SLOT = "elev-raised block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)]";
const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-inset)]";

/**
 * The page's frame (LeitfadenView): the title row on the phone, the search
 * row, then the cards (`cardsOf`: Telefon, E-Mail, WhatsApp apart) with their group bands and one slot per
 * closed row (56 px, taller where its title wraps), counted from the same `SECTIONS`, and from xl the section
 * rail. Nothing moves when the page arrives.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <PageHeader
        title={LEITFADEN_PAGE.title}
        className="mb-4 md:sr-only"
        actions={<span className={cn(RAISED_SLOT, PDF_WIDTH, "md:hidden")} />}
      />
      <div className={STACK}>
        <div className="-mx-4 -my-2 flex items-center gap-2 px-4 py-2 md:m-0 md:min-h-[var(--shell-row)] md:p-0">
          <span className={cn(FIELD_SLOT, "min-w-0 flex-1 xl:max-w-sm")} />
          <span className={cn(RAISED_SLOT, "w-[var(--control-h)] shrink-0 xl:hidden")} />
          <span className={cn(RAISED_SLOT, PDF_WIDTH, "hidden shrink-0 md:ml-auto md:block")} />
        </div>
        <div className={COLUMNS}>
          <div className={STACK}>
            {SECTIONS.flatMap(cardsOf).map((c) => (
              <DashCard key={c.key} title={c.title}>
                {c.groups.map((g, i) => (
                  <div key={g.id} className={cn(i > 0 && GROUP_GAP)}>
                    {g.label && <div className={cn(TABLE_HEAD_BAND, "flex items-center px-3 font-medium")}>{g.label}</div>}
                    {g.warning && (
                      // The rule itself (static text), so it wraps to the
                      // same height as on the page.
                      <p className="flex gap-3 border-b border-border py-3 text-[15px] font-semibold leading-6 text-fg-primary">
                        <span aria-hidden className="h-6 w-6 shrink-0 rounded-full bg-fg-primary" />
                        <span>{g.warning}</span>
                      </p>
                    )}
                    <ul className="divide-y divide-border">
                      {g.items.map((it) => (
                        // The white 4 px on the li, the slot inside it, as the
                        // row's button is. The slot holds the title unseen, so
                        // a title that wraps makes it as tall as on the page.
                        <li key={it.id} className={WASH_ROW}>
                          <div className={cn("relative flex items-center gap-3", ROW)}>
                            {it.warning && <span className="h-6 w-6 shrink-0" />}
                            {/* A button resets the body's word spacing; the slot does too, so it wraps where the title does. */}
                            <span className="invisible min-w-0 flex-1 text-[15px] font-medium leading-5 [word-spacing:normal]">
                              {it.title}
                            </span>
                            <span className="h-4 w-4 shrink-0" />
                            <span className={cn(BAR, "absolute left-0 top-1/2 h-4 w-60 max-w-[80%] -translate-y-1/2")} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </DashCard>
            ))}
          </div>
          <div className="hidden xl:block">
            <div className="text-sm font-medium leading-5 text-fg-primary">{LEITFADEN_PAGE.toc}</div>
            <ul className="mt-3 border-l border-border">
              {SECTIONS.map((s) => (
                <li key={s.id} className="py-1.5 pl-3 text-sm leading-5 text-fg-secondary">
                  {s.title}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
