/**
 * Known German/English header aliases for PVS CSV exports. Pure module (no
 * server-only, no Node APIs) so both the parser (header-row detection) and
 * the wizard (auto-mapping) can import it.
 */

/** Lowercase, strip diacritics and everything that is not a letter/digit. */
export function normaliseHeader(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export const FIELD_ALIASES: Record<string, string[]> = {
  pvsPatientId: [
    "patnr", "patientennr", "patientennummer", "patientid", "patid", "pat",
    "patnummer", "patientnr", "kundennr", "kundennummer", "patientenid",
  ],
  pvsInvoiceId: [
    "rechnungsnummer", "rechnungsnr", "rechnungnr", "rechnung", "belegnr",
    "belegnummer", "rechnr", "renr", "invoiceid", "invoicenumber", "rechnungsid",
  ],
  amount: [
    "betrag", "gesamtbetrag", "rechnungsbetrag", "bruttobetrag", "honorar",
    "zahlbetrag", "endbetrag", "amount", "umsatz", "brutto", "summe",
  ],
  paidAt: [
    "zahldatum", "zahlungsdatum", "bezahltam", "bezahltdatum", "zahlungseingang",
    "paidat", "eingangsdatum", "datum", "rechnungsdatum", "belegdatum",
  ],
  statusColumn: [
    "status", "zahlstatus", "zahlungsstatus", "rechnungsstatus", "zustand",
  ],
  pvsAppointmentId: ["terminnr", "terminid", "terminnummer", "appointmentid"],
  pvsEncounterId: ["behandlungsnr", "behandlungsid", "behandlungsnummer", "encounterid"],
  scheduledAt: ["termin", "terminbeginn", "termindatum", "datum", "terminzeit"],
  completedAt: ["behandlungsdatum", "abgeschlossenam", "datum", "behandlungsende"],
  email: ["email", "emailadresse", "mail"],
  phone: ["telefon", "telefonnummer", "tel", "mobil", "handy"],
  fullName: ["name", "vollstaendigername", "patient", "patientenname"],
  dob: ["geburtsdatum", "geburtstag", "geb", "gebdatum", "dob"],
  gender: ["geschlecht", "gender", "sex"],
  bemerkung: ["bemerkung", "notiz", "kommentar", "anmerkung"],
  externalId: ["externeid", "externalid"],
  treatmentCode: ["behandlungscode", "leistungscode", "goanr", "gop", "ziffer"],
  treatmentLabel: ["behandlung", "leistung", "behandlungsbezeichnung", "leistungsbezeichnung"],
  locationCode: ["standortcode", "betriebsstaette"],
  locationLabel: ["standort", "standortbezeichnung"],
  practitionerLabel: ["behandler", "arzt", "aerztin", "behandelnderarzt"],
};

const ALL_ALIASES: ReadonlySet<string> = new Set(
  Object.values(FIELD_ALIASES).flat()
);

export function isKnownHeaderAlias(cell: string): boolean {
  const n = normaliseHeader(cell);
  return n.length > 0 && ALL_ALIASES.has(n);
}

/** Best header for a canonical field: exact field name first, then aliases. */
export function autoMatchHeader(
  field: string,
  headers: string[]
): string | undefined {
  const f = normaliseHeader(field);
  const exact = headers.find((h) => normaliseHeader(h) === f);
  if (exact) return exact;
  const aliases = FIELD_ALIASES[field] ?? [];
  for (const a of aliases) {
    const hit = headers.find((h) => normaliseHeader(h) === a);
    if (hit) return hit;
  }
  return undefined;
}
