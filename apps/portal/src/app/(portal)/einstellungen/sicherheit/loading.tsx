import { cn } from "@eins/ui";
import { DashCard } from "../../dashboard/_components/dash-ui";
import { SettingsHead } from "../_components/SettingsHead";
import { CardBody, CardFoot, FIELD_GRID, Field } from "../_components/settings-ui";
import { COLUMNS, STACK } from "../_lib/sizes";
import { LOGOUT_ALL, PASSWORD_RULE } from "./_copy";

const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--well)]";
const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";
const RAISED_SLOT =
  "elev-raised block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--surface-raised)]";

/**
 * Sicherheit before it arrives: the same head, the same two cards with their
 * labels, fixed sentences and feet (`page.tsx`), so nothing moves.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="Sicherheit" />
      <div className={COLUMNS}>
        <div className={STACK}>
          <DashCard title="Passwort" bodyClassName="p-0 md:p-0">
            <CardBody>
              <div className={cn(FIELD_GRID, "items-start")}>
                <Field label="Aktuelles Passwort" className="md:col-span-2 md:w-[calc(50%-0.5rem)]">
                  <span className={FIELD_SLOT} />
                </Field>
                <Field label="Neues Passwort">
                  <span className={FIELD_SLOT} />
                  <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{PASSWORD_RULE}</p>
                </Field>
                <Field label="Neues Passwort wiederholen">
                  <span className={FIELD_SLOT} />
                  <p className="mt-1.5 min-h-5" />
                </Field>
              </div>
            </CardBody>
            <CardFoot>
              <span className={cn(BUTTON_SLOT, "w-[9.5rem]")} />
            </CardFoot>
          </DashCard>

          <DashCard title="Auf allen Geräten abmelden" bodyClassName="p-0 md:p-0">
            <CardBody className="space-y-3">
              <p className="text-[15px] leading-6 text-fg-primary">{LOGOUT_ALL}</p>
            </CardBody>
            <CardFoot>
              <span className={cn(RAISED_SLOT, "w-[9rem]")} />
            </CardFoot>
          </DashCard>
        </div>
      </div>
    </div>
  );
}
