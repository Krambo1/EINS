import { eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { PendingSubmit } from "@/app/(portal)/_components/PendingSubmit";
import { ActionForm } from "@/app/(portal)/_components/ActionForm";
import { updateAdsConversionConfigAction } from "../../actions";
import { SettingsHead, WERBEKONTEN } from "../../_components/SettingsHead";
import {
  CardBody,
  CardFoot,
  FIELD_GRID,
  Field,
  PRIMARY_BUTTON,
  SettingsCard,
  TextInput,
} from "../../_components/settings-ui";
import { COLUMNS, STACK } from "../../_lib/sizes";
import { ADS_CUSTOMER_ID, ADS_MCC } from "./_copy";

/**
 * /einstellungen/integrationen/ads-conversion
 *
 * The Google Ads account numbers the conversion upload needs, reached from
 * the Google row under Werbekonten, so the way back leads there.
 */

export const metadata = { title: "Google Ads" };

export default async function AdsConversionConfigPage() {
  const session = await requireSession();

  const [clinic] = await db
    .select({
      googleAdsCustomerId: schema.clinics.googleAdsCustomerId,
      googleAdsLoginCustomerId: schema.clinics.googleAdsLoginCustomerId,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  return (
    <div className={STACK}>
      <SettingsHead title="Google Ads" trail={[WERBEKONTEN]} />
      <div className={COLUMNS}>
        <SettingsCard id="konto" title="Konto">
          <ActionForm action={updateAdsConversionConfigAction}>
            <CardBody>
              <div className={FIELD_GRID}>
                <Field label="Kundennummer" htmlFor="googleAdsCustomerId" explain={ADS_CUSTOMER_ID}>
                  <TextInput
                    id="googleAdsCustomerId"
                    name="googleAdsCustomerId"
                    defaultValue={clinic?.googleAdsCustomerId ?? ""}
                    placeholder="123-456-7890"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="MCC-Konto (optional)" htmlFor="googleAdsLoginCustomerId" explain={ADS_MCC}>
                  <TextInput
                    id="googleAdsLoginCustomerId"
                    name="googleAdsLoginCustomerId"
                    defaultValue={clinic?.googleAdsLoginCustomerId ?? ""}
                    placeholder="z. B. 555-666-7777"
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </CardBody>
            <CardFoot>
              <PendingSubmit className={PRIMARY_BUTTON}>Speichern</PendingSubmit>
            </CardFoot>
          </ActionForm>
        </SettingsCard>
      </div>
    </div>
  );
}
