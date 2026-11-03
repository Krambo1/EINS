import { cn } from "@eins/ui";
import { DashCard } from "../../../dashboard/_components/dash-ui";
import { SettingsHead, WERBEKONTEN } from "../../_components/SettingsHead";
import { CardBody, CardFoot, FIELD_GRID, Field } from "../../_components/settings-ui";
import { COLUMNS, STACK } from "../../_lib/sizes";
import { ADS_CUSTOMER_ID, ADS_MCC } from "./_copy";

const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--well)]";
const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";

/** Google Ads before it arrives: the same head, card, labels and foot. */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="Google Ads" trail={[WERBEKONTEN]} />
      <div className={COLUMNS}>
        <DashCard title="Konto" bodyClassName="p-0 md:p-0">
          <CardBody>
            <div className={FIELD_GRID}>
              <Field label="Kundennummer" explain={ADS_CUSTOMER_ID}>
                <span className={FIELD_SLOT} />
              </Field>
              <Field label="MCC-Konto (optional)" explain={ADS_MCC}>
                <span className={FIELD_SLOT} />
              </Field>
            </div>
          </CardBody>
          <CardFoot>
            <span className={cn(BUTTON_SLOT, "w-[6.75rem]")} />
          </CardFoot>
        </DashCard>
      </div>
    </div>
  );
}
