/**
 * The 16 German Länder, keyed by their ISO 3166-2:DE subdivision code
 * (clinics.bundesland, migration 0104). Seat of the Praxis for the
 * statutory holidays of the 48-Werkstunden rule (lib/werkstunden.ts).
 */

export const BUNDESLAENDER = [
  "BW",
  "BY",
  "BE",
  "BB",
  "HB",
  "HH",
  "HE",
  "MV",
  "NI",
  "NW",
  "RP",
  "SL",
  "SN",
  "ST",
  "SH",
  "TH",
] as const;
export type Bundesland = (typeof BUNDESLAENDER)[number];

export const BUNDESLAND_LABELS: Record<Bundesland, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

export function isBundesland(value: unknown): value is Bundesland {
  return typeof value === "string" && (BUNDESLAENDER as readonly string[]).includes(value);
}

/** DB value to Bundesland; anything unknown (or null) means "not stored". */
export function toBundesland(value: unknown): Bundesland | null {
  return isBundesland(value) ? value : null;
}
