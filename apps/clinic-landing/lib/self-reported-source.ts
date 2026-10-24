/**
 * "Wie sind Sie auf uns aufmerksam geworden?" on the Zielseite form.
 *
 * Closed list, no free text, so no health data can land there. The values
 * match the portal's SELF_REPORTED_SOURCES (apps/portal/src/lib/sources.ts)
 * minus "anruf_praxis", which only the Praxis team can enter. The answer is a
 * self-report: it never changes the Messweg and never triggers the invoice
 * (KANON § 5), it only shows in the Auswertung.
 */
export const LANDING_SELF_REPORTED_SOURCES = [
  "instagram",
  "facebook",
  "tiktok",
  "google_suche",
  "empfehlung",
  "sonstiges",
] as const;

export type LandingSelfReportedSource = (typeof LANDING_SELF_REPORTED_SOURCES)[number];

export const LANDING_SELF_REPORTED_SOURCE_OPTIONS: ReadonlyArray<{
  id: LandingSelfReportedSource;
  label: string;
}> = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "google_suche", label: "Google-Suche" },
  { id: "empfehlung", label: "Empfehlung" },
  { id: "sonstiges", label: "Sonstiges" },
];

/** The allowed value, or undefined for anything else (the inquiry is never lost over it). */
export function parseLandingSelfReportedSource(
  raw: unknown,
): LandingSelfReportedSource | undefined {
  return typeof raw === "string" &&
    (LANDING_SELF_REPORTED_SOURCES as readonly string[]).includes(raw)
    ? (raw as LandingSelfReportedSource)
    : undefined;
}
