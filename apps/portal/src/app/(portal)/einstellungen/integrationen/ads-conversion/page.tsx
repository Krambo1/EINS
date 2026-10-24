import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Separator,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { updateAdsConversionConfigAction } from "../../actions";

/**
 * /einstellungen/integrationen/ads-conversion
 *
 * Per-praxis configuration for the closed-loop revenue attribution
 * pipeline. Lives behind /einstellungen/integrationen because it's part
 * of the same operational concern: connecting the praxis's external
 * systems (Meta, Google, PVS) to the portal.
 */

export const metadata = { title: "Abschluss-Meldungen an Meta und Google" };

export default async function AdsConversionConfigPage() {
  const session = await requireSession();

  const [clinic] = await db
    .select({
      metaPixelId: schema.clinics.metaPixelId,
      googleAdsCustomerId: schema.clinics.googleAdsCustomerId,
      googleAdsConversionAction: schema.clinics.googleAdsConversionAction,
      googleAdsLoginCustomerId: schema.clinics.googleAdsLoginCustomerId,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  const metaReady = Boolean(clinic?.metaPixelId);
  const googleReady = Boolean(
    clinic?.googleAdsCustomerId && clinic?.googleAdsConversionAction
  );

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
          Abschluss-Meldungen an Meta und Google
        </h1>
        <p className="mt-1 text-base text-fg-primary">
          Das Portal meldet Meta und Google, welche Anzeigen zu echten
          Anfragen geführt haben. So zeigen die Plattformen Ihre Anzeigen eher
          Menschen, die wirklich eine Behandlung wollen, statt Menschen, die
          nur klicken.
        </p>
        <p className="mt-2 text-sm text-fg-secondary">
          Gemeldet wird nur, wenn beides zutrifft: Die Person hat im Formular
          eingewilligt, und sie kam über eine bezahlte Anzeige dieser
          Plattform. Meta erfährt nur, dass eine Anfrage einging, nie eine
          Rechnung oder einen Betrag. Google erhält zusätzlich den
          Rechnungsbetrag aus Ihrer Praxis-Software.
        </p>
      </header>

      <form action={updateAdsConversionConfigAction} className="space-y-6">
        {/* Meta */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Meta Conversions API</CardTitle>
              <CardDescription>
                Meldet Meta jede Anfrage mit Einwilligung, die über eine
                Meta-Anzeige kam. Keine Rechnungen, keine Beträge.
              </CardDescription>
            </div>
            <Badge tone={metaReady ? "good" : "neutral"}>
              {metaReady ? "Konfiguriert" : "Nicht aktiv"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="metaPixelId"
                className="mb-1 block text-sm font-medium text-fg-primary"
              >
                Pixel-ID
              </label>
              <input
                id="metaPixelId"
                name="metaPixelId"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{10,20}"
                defaultValue={clinic?.metaPixelId ?? ""}
                placeholder="z. B. 123456789012345"
                className="w-full max-w-sm h-11 rounded-xl border border-border bg-bg-primary px-3 text-base text-fg-primary"
              />
              <p className="mt-1 text-sm text-fg-secondary">
                Die Nummer Ihres Meta-Pixels, eines kleinen Messbausteins auf
                Ihrer Zielseite. Sie steht im Meta Business Manager unter
                „Events Manager → Datenquellen" neben dem Pixel-Namen.
              </p>
            </div>
            <Separator />
            <div className="rounded-xl border border-dashed border-border p-3 text-sm">
              <div className="font-medium text-fg-primary">
                Zugangsschlüssel für Meta (Access Token)
              </div>
              <p className="mt-1 text-fg-secondary">
                Den Schlüssel richtet EINS auf dem Server ein, er liegt nicht in
                der Datenbank. Sie müssen hier nichts tun.
              </p>
              <p className="mt-2 text-fg-secondary">
                Melden Ihre Zielseiten schon Anfragen an Meta, ist dieser
                Schlüssel bereits gesetzt.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Google */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Google Ads: Offline Conversion Import</CardTitle>
              <CardDescription>
                Meldet Google den Rechnungsbetrag aus Ihrer Praxis-Software,
                wenn die Person eingewilligt hat und über eine Google-Anzeige
                kam.
              </CardDescription>
            </div>
            <Badge tone={googleReady ? "good" : "neutral"}>
              {googleReady ? "Konfiguriert" : "Nicht aktiv"}
            </Badge>
          </CardHeader>
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
                htmlFor="googleAdsConversionAction"
                className="mb-1 block text-sm font-medium text-fg-primary"
              >
                Conversion-Action (Resource-Name)
              </label>
              <input
                id="googleAdsConversionAction"
                name="googleAdsConversionAction"
                type="text"
                defaultValue={clinic?.googleAdsConversionAction ?? ""}
                placeholder="customers/1234567890/conversionActions/9876543210"
                className="w-full max-w-2xl h-11 rounded-xl border border-border bg-bg-primary px-3 text-base text-fg-primary font-mono"
              />
              <p className="mt-1 text-sm text-fg-secondary">
                Die Conversion-Action ist der Zähler in Google Ads, in den die
                Beträge einlaufen. So legen Sie sie an: In Google Ads unter
                „Tools → Conversions" eine
                neue Conversion-Action „Purchase" anlegen (Quelle: Import,
                Wert: pro Conversion variabel, Zählung: pro Conversion).
                Anschließend den vollen Resource-Name aus der API-Detail-Seite
                hier einfügen.
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
          <Button type="submit" className="h-auto min-h-11 whitespace-normal py-2 text-left">
            Einstellungen für Abschluss-Meldungen speichern
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wie es funktioniert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-base text-fg-primary">
          <p>
            <strong>Schritt 1:</strong> Eine Person klickt eine Meta- oder
            Google-Anzeige und schickt über Ihre Zielseite eine Anfrage. Die
            Zielseite merkt sich, über welche Anzeige sie kam, und fragt nach
            der Einwilligung.
          </p>
          <p>
            <strong>Schritt 2:</strong> Hat die Person eingewilligt und kam sie
            über eine Meta-Anzeige, meldet das Portal Meta die Anfrage. Mehr
            erfährt Meta nicht.
          </p>
          <p>
            <strong>Schritt 3:</strong> Wird aus der Anfrage eine bezahlte
            Behandlung, meldet Ihre Praxis-Software die Rechnung an das Portal.
            Hat die Person eingewilligt und kam sie über eine Google-Anzeige,
            meldet das Portal Google den Betrag.
          </p>
          <p>
            <strong>Wirkung:</strong> Beide Plattformen lernen mit der Zeit,
            wem sie Ihre Anzeigen zeigen sollen: Menschen, die anfragen und
            sich behandeln lassen, statt Menschen, die nur klicken.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
