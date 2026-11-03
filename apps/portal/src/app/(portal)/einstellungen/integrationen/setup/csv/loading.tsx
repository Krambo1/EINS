import { cn } from "@eins/ui";
import { DashCard } from "../../../../dashboard/_components/dash-ui";
import { ANBINDUNG_WAEHLEN, EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { CardBody, CardFoot, FIELD_GRID, Field } from "../../../_components/settings-ui";
import { COLUMNS, STACK } from "../../../_lib/sizes";
import { FILE_FIELD, FILE_HINT, STREAM_FIELD, STREAM_HINT } from "./_copy";

const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--well)]";
const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";

/**
 * The CSV page before it arrives: the same head and the wizard's first step
 * (labels, lines, foot), so nothing moves. The list of earlier files is
 * added below when there are any.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="CSV-Datei laden" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE, ANBINDUNG_WAEHLEN]} />
      <div className={COLUMNS}>
        <DashCard
          title="Datei wählen"
          action={<span className="text-sm text-fg-secondary">Schritt 1 von 3</span>}
          bodyClassName="p-0 md:p-0"
        >
          <CardBody>
            <div className={cn(FIELD_GRID, "items-start")}>
              <Field label={STREAM_FIELD}>
                <span className={FIELD_SLOT} />
                <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{STREAM_HINT}</p>
              </Field>
              <Field label={FILE_FIELD}>
                <span className={FIELD_SLOT} />
                <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{FILE_HINT}</p>
              </Field>
            </div>
          </CardBody>
          <CardFoot>
            <span className={cn(BUTTON_SLOT, "w-[15.5rem]")} />
          </CardFoot>
        </DashCard>
      </div>
    </div>
  );
}
