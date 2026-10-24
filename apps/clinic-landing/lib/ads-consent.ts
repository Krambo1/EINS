/**
 * Separate, optional consent: Meta gets only the inquiry, Google gets the
 * inquiry and later treatment + amount (owner decision 2026-10-06; Meta
 * purchase reporting is off, see portal lib/ads-report-gate.ts).
 *
 * Bump ADS_CONSENT_VERSION whenever the wording below changes. The version is
 * sent with the inquiry and stored on the portal request
 * (requests.ads_consent_version), so it is always clear which text a person
 * agreed to.
 */

export const ADS_CONSENT_VERSION = "2026-10-06";

/** First line of the checkbox label (shown emphasized). */
export function adsConsentHeadline(praxisName: string | null | undefined): string {
  const praxis = praxisName && praxisName.trim().length > 0 ? praxisName.trim() : "die Praxis";
  return (
    `Freiwillig: Ich bin einverstanden, dass ${praxis} Meta (Facebook, Instagram) und Google ` +
    "mitteilt, dass ich über eine ihrer Anzeigen angefragt habe, und Google später außerdem, " +
    "ob ich behandelt wurde und zu welchem Betrag."
  );
}

/** Details under the headline (shown smaller). */
export const ADS_CONSENT_DETAILS =
  "Das sind Gesundheitsangaben. Übermittelt werden auch die Adresse der Website, die " +
  "Klick-Kennung der Anzeige, gekürzte IP-Adresse und Browser-Kennung sowie Name, E-Mail-Adresse " +
  "und Telefonnummer, diese nur verschlüsselt (gehasht). Zweck: Die Praxis kann ihre Anzeigen " +
  "gezielter zeigen. Meta und Google können die Daten auch in den USA verarbeiten. Ich kann " +
  "diese Einwilligung jederzeit formlos bei der Praxis widerrufen.";
