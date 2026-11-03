import { cn } from "@eins/ui";
import { DashCard } from "../../../../dashboard/_components/dash-ui";
import { ANBINDUNG_WAEHLEN, EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { CardBody, CardFoot, Field } from "../../../_components/settings-ui";
import { COLUMNS, SKELETON_BAR, STACK } from "../../../_lib/sizes";
import { Steps } from "../_steps";
import { N8N_STEPS, SECRET_HOW, SECRET_ONCE, SECRET_WELL } from "./_copy";

const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";
const RAISED_SLOT =
  "elev-raised block h-[var(--control-h)] w-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--surface-raised)]";

/** The n8n page before it arrives: the same head, steps, fields, well and foot. */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="n8n-Ablauf" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE, ANBINDUNG_WAEHLEN]} />
      <div className={COLUMNS}>
        <div className={STACK}>
          <DashCard title="So funktioniert es" bodyClassName="p-0 md:p-0">
            <CardBody>
              <Steps>{N8N_STEPS}</Steps>
            </CardBody>
          </DashCard>
          <DashCard title="Zugangsdaten" bodyClassName="p-0 md:p-0">
            <CardBody className="space-y-5">
              <Field label="Ihre Praxis-Kennung für n8n">
                <div className="flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center">
                    <span className={cn(SKELETON_BAR, "h-4 w-72 max-w-full")} />
                  </span>
                  <span className={RAISED_SLOT} />
                </div>
              </Field>
              <Field label="Geheimer Schlüssel">
                <div
                  className={cn(
                    SECRET_WELL,
                    "elev-inset flex flex-col justify-center gap-2 rounded-[var(--r-control)] bg-[var(--well)] p-3"
                  )}
                >
                  <p className="text-sm leading-5 text-fg-secondary">{SECRET_ONCE}</p>
                </div>
                <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{SECRET_HOW}</p>
              </Field>
            </CardBody>
            <CardFoot>
              <span className={cn(BUTTON_SLOT, "w-[10.5rem]")} />
            </CardFoot>
          </DashCard>
        </div>
      </div>
    </div>
  );
}
