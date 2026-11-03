import { cn } from "@eins/ui";
import { DashCard } from "../../../../dashboard/_components/dash-ui";
import { ANBINDUNG_WAEHLEN, EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { CardBody, CardFoot, Field } from "../../../_components/settings-ui";
import { COLUMNS, STACK } from "../../../_lib/sizes";
import { Steps } from "../_steps";
import { CODE_WELL, FINGERPRINT_HINT, GDT_STEPS, ONCE } from "./_copy";

const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--well)]";
const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";

/**
 * The GDT-Agent page before the open codes arrive: the same head, steps and
 * code card (field, hint, empty well, foot), so nothing moves. The list of
 * open codes is added below when there are any.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="GDT-Agent" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE, ANBINDUNG_WAEHLEN]} />
      <div className={COLUMNS}>
        <div className={STACK}>
          <DashCard title="So funktioniert es" bodyClassName="p-0 md:p-0">
            <CardBody>
              <Steps>{GDT_STEPS}</Steps>
            </CardBody>
          </DashCard>
          <DashCard title="Einrichtungs-Code" bodyClassName="p-0 md:p-0">
            <CardBody className="space-y-5">
              <Field label="Name des Praxisrechners (optional)">
                <span className={cn(FIELD_SLOT, "md:w-[calc(50%-0.5rem)]")} />
                <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{FINGERPRINT_HINT}</p>
              </Field>
              <div
                className={cn(
                  CODE_WELL,
                  "elev-inset flex flex-col justify-center gap-2 rounded-[var(--r-control)] bg-[var(--well)] p-3"
                )}
              >
                <p className="text-sm leading-5 text-fg-secondary">{ONCE}</p>
              </div>
            </CardBody>
            <CardFoot>
              <span className={cn(BUTTON_SLOT, "w-[14.5rem]")} />
            </CardFoot>
          </DashCard>
        </div>
      </div>
    </div>
  );
}
