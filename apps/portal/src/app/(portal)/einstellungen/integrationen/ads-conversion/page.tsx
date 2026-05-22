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
import { metaCapiTokenEnvName } from "@/server/conversion-config";
import { updateAdsConversionConfigAction } from "../../actions";

/**
 * /einstellungen/integrationen/ads-conversion
 *
 * Per-praxis configuration for the closed-loop revenue attribution
 * pipeline. Lives behind /einstellungen/integrationen because it's part
 * of the same operational concern: connecting the praxis's external
 * systems (Meta, Google, PVS) to the portal.
 */

export const metadata = { title: "Conversion-Tracking (Meta + Google)" };

export default async function AdsConversionConfigPage() {
  const session = await requireSession();

  const [clinic] = await db
    .select({
      slug: schema.clinics.slug,
      metaPixelId: schema.clinics.metaPixelId,
      googleAdsCustomerId: schema.clinics.googleAdsCustomerId,
      googleAdsConversionAction: schema.clinics.googleAdsConversionAction,
      googleAdsLoginCustomerId: schema.clinics.googleAdsLoginCustomerId,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  const capiTokenEnvName = clinic ? metaCapiTokenEnvName(clinic.slug) : "";
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
            className="text-muted-foreground hover:underline"
          >
            ← Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">
          Conversion-Tracking: Meta + Google
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sobald eingerichtet, meldet das Portal jede bezahlte Rechnung mit
          tatsächlichem EUR-Wert zurück an Meta und Google. Die Algorithmen
          lernen so auf echte Umsatz-Patient:innen zu optimieren, nicht auf
          billige Klicks. Voraussetzung: die PVS-Bridge liefert
          InvoicePaid-Events und das Lead-Formular hat den fbclid oder gclid
          beim Erstkontakt mitgespeichert.
        </p>
      </header>

      <form action={updateAdsConversionConfigAction} className="space-y-6">
        {/* Meta */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Meta Conversions API</CardTitle>
              <CardDescription>
                Server-seitige Purchase-Events nach jeder bezahlten Rechnung.
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
                className="mb-1 block text-sm font-medium"
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
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Im Meta Business Manager unter „Events Manager → Datenquellen"
                neben dem Pixel-Namen.
              </p>
            </div>
            <Separator />
            <div className="rounded-md border border-dashed border-muted-foreground/30 p-3 text-xs">
              <div className="font-medium">Access Token: Umgebungs-Variable</div>
              <p className="mt-1 text-muted-foreground">
                Das CAPI-System-User-Token wird nicht in der Datenbank
                gespeichert, sondern in der Vercel-/Server-Umgebung unter dem
                Namen:
              </p>
              <code className="mt-2 inline-block rounded bg-muted px-2 py-1">
                {capiTokenEnvName || "META_CAPI_TOKEN_<SLUG>"}
              </code>
              <p className="mt-2 text-muted-foreground">
                Diese Konvention spiegelt das Lead-Tracking auf den Landingpages
                wider — wenn dort bereits Lead-Events laufen, sind auch
                Purchase-Events automatisch scharf.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Google */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Google Ads — Offline Conversion Import</CardTitle>
              <CardDescription>
                Upload echter EUR-Werte über die Google-Ads-API
                (uploadClickConversions), gebunden an die gespeicherte gclid.
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
                className="mb-1 block text-sm font-medium"
              >
                Google-Ads-Customer-ID
              </label>
              <input
                id="googleAdsCustomerId"
                name="googleAdsCustomerId"
                type="text"
                defaultValue={clinic?.googleAdsCustomerId ?? ""}
                placeholder="123-456-7890"
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Im Google-Ads-Kopf rechts neben dem Konto-Namen. Bindestriche
                optional.
              </p>
            </div>
            <div>
              <label
                htmlFor="googleAdsConversionAction"
                className="mb-1 block text-sm font-medium"
              >
                Conversion-Action (Resource-Name)
              </label>
              <input
                id="googleAdsConversionAction"
                name="googleAdsConversionAction"
                type="text"
                defaultValue={clinic?.googleAdsConversionAction ?? ""}
                placeholder="customers/1234567890/conversionActions/9876543210"
                className="w-full max-w-2xl rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Vorgehensweise: In Google Ads unter „Tools → Conversions" eine
                neue Conversion-Action „Purchase" anlegen (Quelle: Import,
                Wert: pro Conversion variabel, Zählung: pro Conversion).
                Anschließend den vollen Resource-Name aus der API-Detail-Seite
                hier einfügen.
              </p>
            </div>
            <div>
              <label
                htmlFor="googleAdsLoginCustomerId"
                className="mb-1 block text-sm font-medium"
              >
                MCC-Manager-Konto (optional)
              </label>
              <input
                id="googleAdsLoginCustomerId"
                name="googleAdsLoginCustomerId"
                type="text"
                defaultValue={clinic?.googleAdsLoginCustomerId ?? ""}
                placeholder="z. B. 555-666-7777"
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Nur ausfüllen, wenn dieses Praxis-Konto über ein anderes
                MCC-Manager-Konto verwaltet wird als das EINS-Standard-MCC.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit">Conversion-Einstellungen speichern</Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wie es funktioniert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Schritt 1:</strong> Patient:in klickt eine Meta- oder
            Google-Anzeige; die Landingpage speichert fbclid/gclid auf der
            Anfrage.
          </p>
          <p>
            <strong>Schritt 2:</strong> Anfrage wird zu Termin, Behandlung,
            Rechnung. PVS-Bridge meldet die bezahlte Rechnung als
            InvoicePaid-Event an das Portal.
          </p>
          <p>
            <strong>Schritt 3:</strong> Das Portal verknüpft die Rechnung mit
            der Ursprungs-Anfrage und sendet eine Purchase-Conversion mit
            echtem EUR-Wert an Meta CAPI und Google OCI.
          </p>
          <p>
            <strong>Effekt:</strong> Nach 4–8 Wochen Algorithmus-Training
            optimieren beide Plattformen auf bezahlende Patient:innen statt
            auf billige Klicks. Branchen-Erfahrung: CPL halbiert sich, ROAS
            verdoppelt sich.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
