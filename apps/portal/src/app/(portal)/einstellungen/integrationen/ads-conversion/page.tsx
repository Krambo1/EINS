import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  Card,
  CardContent,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { PendingSubmit } from "@/app/(portal)/_components/PendingSubmit";
import { updateAdsConversionConfigAction } from "../../actions";
import { ActionForm } from "@/app/(portal)/_components/ActionForm";

/**
 * /einstellungen/integrationen/ads-conversion
 *
 * Per-praxis configuration. Lives behind /einstellungen/integrationen because it's part
 * of the same operational concern: connecting the praxis's external
 * systems (Meta, Google, PVS) to the portal.
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
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen"
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">
          Google Ads
        </h1>
      </header>

      <ActionForm action={updateAdsConversionConfigAction} className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="googleAdsCustomerId"
                className="mb-1 block text-sm font-medium text-fg-primary"
              >
                Google-Ads-Kundennummer (Customer-ID)
              </label>
              <input
                id="googleAdsCustomerId"
                name="googleAdsCustomerId"
                type="text"
                defaultValue={clinic?.googleAdsCustomerId ?? ""}
                placeholder="123-456-7890"
                className="w-full max-w-sm h-11 rounded-xl border border-border bg-bg-primary px-3 text-base text-fg-primary"
              />
              <p className="mt-1 text-sm text-fg-secondary">
                Steht in Google Ads oben rechts neben dem Kontonamen.
                Bindestriche sind egal.
              </p>
            </div>
            <div>
              <label
                htmlFor="googleAdsLoginCustomerId"
                className="mb-1 block text-sm font-medium text-fg-primary"
              >
                MCC-Manager-Konto (optional)
              </label>
              <input
                id="googleAdsLoginCustomerId"
                name="googleAdsLoginCustomerId"
                type="text"
                defaultValue={clinic?.googleAdsLoginCustomerId ?? ""}
                placeholder="z. B. 555-666-7777"
                className="w-full max-w-sm h-11 rounded-xl border border-border bg-bg-primary px-3 text-base text-fg-primary"
              />
              <p className="mt-1 text-sm text-fg-secondary">
                Ein MCC ist ein Sammelkonto, über das mehrere Google-Ads-Konten
                verwaltet werden. Nur ausfüllen, wenn Ihr Konto über ein
                anderes MCC läuft als das von EINS.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <PendingSubmit className="h-auto min-h-11 whitespace-normal py-2 text-left">
            Einstellungen für Google Ads speichern
          </PendingSubmit>
        </div>
      </ActionForm>
    </div>
  );
}
