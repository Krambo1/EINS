import { Button, cn } from "@eins/ui";
import { SELF_REPORTED_SOURCES } from "@/lib/sources";
import { CardBody, FIELD_GRID, Field, PRIMARY_BUTTON } from "../../einstellungen/_components/settings-ui";
import { FIELD, SKELETON_BAR } from "../../einstellungen/_lib/sizes";
import { AnfrageAnlegenHead } from "./_head";
import { GUARANTEE_NOTE } from "./_lib/copy";
import { FOOT, PAGE_WIDTH, SOURCE_GRID, SOURCE_ROW, STACK } from "./_lib/sizes";

/**
 * "Anfrage anlegen" while the Behandlungen load: the head, the card and
 * every field at its size (_lib/sizes.ts), so nothing moves when the form
 * arrives.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" aria-label="Formular wird geladen" className={cn(PAGE_WIDTH, STACK)}>
      <AnfrageAnlegenHead />
      <div className="anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]">
        <CardBody className="space-y-5 pt-5 md:pt-6">
          <Field label="Name">
            <div className={FIELD} />
          </Field>
          <div>
            <div className={FIELD_GRID}>
              <Field label="Telefon">
                <div className={FIELD} />
              </Field>
              <Field label="E-Mail">
                <div className={FIELD} />
              </Field>
            </div>
            <p className="mt-1.5 text-sm leading-5 text-fg-secondary">Eines von beiden genügt.</p>
          </div>
          <div className={FIELD_GRID}>
            <Field label="Behandlung">
              <div className={FIELD} />
            </Field>
          </div>
          <div className="-mx-2 px-2 pb-1">
            <p className="flex min-h-6 items-center text-sm font-medium leading-5 text-fg-primary">Wie kam die Person zu Ihnen?</p>
            <div className={cn("mt-1.5", SOURCE_GRID)}>
              {SELF_REPORTED_SOURCES.map((s) => (
                <span key={s} className={cn(SOURCE_ROW, "cursor-default hover:bg-transparent")}>
                  <span className="h-5 w-5 shrink-0 rounded-full bg-[var(--well)]" />
                  <span className={cn(SKELETON_BAR, "h-3.5 w-28")} />
                </span>
              ))}
            </div>
          </div>
        </CardBody>
        <div className={FOOT}>
          <p className="min-w-0 text-sm leading-5 text-fg-secondary">{GUARANTEE_NOTE}</p>
          <Button disabled className={cn(PRIMARY_BUTTON, "shrink-0")}>
            Anfrage anlegen
          </Button>
        </div>
      </div>
    </div>
  );
}
