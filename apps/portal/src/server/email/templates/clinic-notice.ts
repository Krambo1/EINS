/**
 * Formal notices from EINS to a Praxis (H-03). Plain, factual wording; the
 * exact text is stored in clinic_notices as proof of what was sent.
 * No patient data: only counts and dates.
 */

const SIGNATURE = ["Freundliche Grüße", "Ihr EINS-Team"].join("\n");

function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export interface VerzugNoticeInput {
  /** Mitwirkung in the Praxis' words, e.g. "Klon-Aufnahme". */
  reason: string;
  /** Last day the Mitwirkung was due (ISO, Berlin). */
  dueOn: string;
  /** Day it was fulfilled, null = still open. */
  fulfilledOn: string | null;
}

export interface StoerungNoticeInput {
  /** What happened, in plain words, e.g. "Instagram hat das Konto der Praxis gesperrt". */
  reason: string;
  /** First day of the Störung (ISO, Berlin). */
  fromOn: string;
  /** Last day, null = still ongoing. */
  toOn: string | null;
}

/** K-7 Teil 2: notice for a Plattform-Störung (Anhang § 3 Abs. (3), § 10). */
export function stoerungNoticeText(input: StoerungNoticeInput): { subject: string; body: string } {
  const period = input.toOn
    ? `Vom ${deDate(input.fromOn)} bis zum ${deDate(input.toOn)} lag eine Störung vor, die unsere Arbeit für Ihre Praxis erheblich beeinträchtigt hat:`
    : `Seit dem ${deDate(input.fromOn)} liegt eine Störung vor, die unsere Arbeit für Ihre Praxis erheblich beeinträchtigt:`;
  const status = input.toOn ? "" : " Sie dauert bis heute an.";
  return {
    subject: "Mitteilung: Plattform-Störung verlängert die 90-Tage-Frist",
    body: [
      "Guten Tag,",
      "",
      `${period} „${input.reason}“.${status}`,
      "",
      "Nach der Vereinbarung „Keine Anfrage, keine Rechnung“ zahlen Sie nichts, bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt; kommt in 90 Tagen keine, endet die Zusammenarbeit. Diese 90-Tage-Frist verlängert sich um die Dauer der Störung. Mit dieser E-Mail teilen wir Ihnen die Störung mit.",
      "",
      "Wenn Sie Fragen haben oder etwas nicht stimmt, antworten Sie einfach auf diese E-Mail.",
      "",
      SIGNATURE,
    ].join("\n"),
  };
}

export function verzugNoticeText(input: VerzugNoticeInput): { subject: string; body: string } {
  const status = input.fulfilledOn
    ? `Sie wurde am ${deDate(input.fulfilledOn)} erledigt.`
    : "Sie ist bis heute offen.";
  return {
    subject: "Mitteilung: offene Mitwirkung verlängert die 90-Tage-Frist",
    body: [
      "Guten Tag,",
      "",
      `die Mitwirkung „${input.reason}“ war bis zum ${deDate(input.dueOn)} fällig. ${status}`,
      "",
      "Nach der Vereinbarung „Keine Anfrage, keine Rechnung“ verlängert jeder Tag, an dem eine Mitwirkung offen ist, die 90-Tage-Frist um einen Tag. Mit dieser E-Mail teilen wir Ihnen den Verzug mit.",
      "",
      "Wenn Sie Fragen haben oder etwas nicht stimmt, antworten Sie einfach auf diese E-Mail.",
      "",
      SIGNATURE,
    ].join("\n"),
  };
}
