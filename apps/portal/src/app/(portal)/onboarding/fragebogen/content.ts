/**
 * Discovery-Fragebogen, Teil 1 (Vorab-Formular) - question definitions.
 *
 * Source of truth for the question SET is the Obsidian note
 * "Discovery-Fragebogen (Kunden-Onboarding)" (10 EINS/Kunden/); this file mirrors Teil 1
 * verbatim (26 Fragen, 19 Pflicht). Teil 2 (Gesprächsleitfaden, incl. Block J
 * "Ihr KI-Klon") is deliberately NOT in the portal - Karam asks those live.
 *
 * Answers are stored as a jsonb map keyed by question id: string for
 * "auswahl" / "text" / "textarea", string[] for "mehrfach". The ids ("A1",
 * "B3", ...) are the contract with the stored answers - never renumber an
 * existing id; retire it and add a new one instead. Answers to unknown ids are
 * dropped on the next save (see saveDiscoveryAction), so retiring is safe.
 * F1 (monthly Werbebudget) keeps its id: same question, options replaced,
 * optional since 2026-09-30; older stored preset strings stay readable.
 */

export type DiscoveryQuestionType = "auswahl" | "mehrfach" | "text" | "textarea";

export interface DiscoveryQuestion {
  /** Stable id, also the jsonb key ("A1"). */
  id: string;
  label: string;
  /** Secondary line under the label (examples, clarification). */
  hint?: string;
  type: DiscoveryQuestionType;
  /** For auswahl/mehrfach. */
  options?: readonly string[];
  /** For mehrfach: cap on selectable options. */
  maxSelect?: number;
  /**
   * For auswahl: also allow a free-entry value alongside the preset pills
   * (e.g. budget). The stored answer is either one of `options` or the raw
   * typed string. Validated separately via `customBudgetError`.
   */
  allowCustom?: boolean;
  /** Label shown next to the free-entry field when `allowCustom`. */
  customLabel?: string;
  /** Pflichtfrage: must be answered before final submit (not for drafts). */
  required: boolean;
}

export interface DiscoveryBlock {
  key: string;
  title: string;
  /** "Warum wir fragen" intro shown above the block's questions. */
  why?: string;
  questions: readonly DiscoveryQuestion[];
}

export const DISCOVERY_INTRO =
  "Diese Antworten sind die Grundlage für Ihren KI-Klon, Ihre Beiträge und Ihre Zielseite. " +
  "Je genauer Sie antworten, desto weniger müssen wir im Gespräch nachfragen. " +
  "Pflichtfragen sind markiert; alles andere können Sie überspringen. " +
  "Dauer: etwa 15 bis 20 Minuten. Schätzungen reichen überall aus, niemand erwartet exakte Zahlen.";

export const DISCOVERY_BLOCKS: readonly DiscoveryBlock[] = [
  {
    key: "A",
    title: "Behandlungen und Wirtschaftlichkeit",
    questions: [
      {
        id: "A1",
        label: "Welche 1 bis 2 Behandlungen sollen wir zuerst bewerben?",
        hint: "Die Behandlung mit der besten Mischung aus Marge, freier Kapazität und Nachfrage.",
        type: "text",
        required: true,
      },
      {
        id: "A2",
        label: "Was kostet diese Behandlung bei Ihnen ungefähr?",
        hint: "Spanne reicht. Bei zwei Fokus-Behandlungen: die teurere.",
        type: "auswahl",
        options: [
          "unter 500 €",
          "500-1.500 €",
          "1.500-5.000 €",
          "5.000-15.000 €",
          "über 15.000 €",
        ],
        required: true,
      },
      {
        id: "A3",
        label:
          "Wie viele zusätzliche Beratungstermine pro Woche könnten Sie für neue Patientinnen und Patienten realistisch annehmen?",
        type: "auswahl",
        options: ["1-3", "4-8", "9-15", "mehr als 15"],
        required: true,
      },
      {
        id: "A4",
        label:
          "Kommen Patientinnen nach dieser Behandlung typischerweise wieder (Auffrischung, Folgebehandlung)?",
        type: "auswahl",
        options: [
          "regelmäßig (mehrmals pro Jahr)",
          "gelegentlich (ca. jährlich)",
          "selten",
          "einmalige Behandlung",
        ],
        required: true,
      },
      {
        id: "A5",
        label: "Gibt es Behandlungen, die wir ausdrücklich NICHT bewerben sollen?",
        hint: "Falls nein, schreiben Sie einfach „keine“.",
        type: "text",
        required: true,
      },
      {
        id: "A6",
        label: "Welche weiteren Behandlungen bieten Sie an?",
        hint: "Vollständige Liste, falls Sie keine aktuelle Behandlungsliste liefern.",
        type: "textarea",
        required: false,
      },
    ],
  },
  {
    key: "B",
    title: "Ausgangslage und Ziel",
    why:
      "Eine ausgelastete Praxis braucht eine andere Strategie als eine Praxis mit freien Terminen. " +
      "Wenn wir das falsch einschätzen, bewerben wir das Falsche.",
    questions: [
      {
        id: "B1",
        label: "Welche Beschreibung trifft Ihre Praxis aktuell am besten?",
        type: "auswahl",
        options: [
          "Wir haben freie Kapazität und wollen mehr Patientinnen",
          "Wir sind gut ausgelastet, wollen aber bessere Patientinnen (höherwertige Behandlungen, weniger Preisvergleicher)",
          "Beides: mehr und bessere",
        ],
        required: true,
      },
      {
        id: "B2",
        label: "Was soll in 12 Monaten konkret anders sein?",
        hint: "Ein bis drei Sätze in Ihren Worten.",
        type: "textarea",
        required: true,
      },
      {
        id: "B3",
        label:
          "Wie stark schwankt Ihre Auslastung übers Jahr? Welche Monate sind stark, welche schwach?",
        type: "text",
        required: true,
      },
      {
        id: "B4",
        label: "Gibt es einen konkreten Anlass für den Start jetzt?",
        hint: "Neues Gerät, neuer Arzt, Standort, Wettbewerb, ...",
        type: "text",
        required: false,
      },
    ],
  },
  {
    key: "C",
    title: "Woher Ihre Patientinnen heute kommen",
    why:
      "Wir messen später jede Anfrage. Dafür brauchen wir den heutigen Stand als Vergleichsbasis.",
    questions: [
      {
        id: "C1",
        label:
          "Schätzen Sie: Woher kommen Ihre neuen Patientinnen heute überwiegend?",
        hint: "Bis zu 3 auswählen.",
        type: "mehrfach",
        options: [
          "Empfehlung von Patientinnen",
          "Empfehlung von Ärzten",
          "Google-Suche",
          "Google Maps",
          "Instagram",
          "Vorbeigang am Standort",
          "Presse oder Print",
          "weiß ich ehrlich nicht",
        ],
        maxSelect: 3,
        required: true,
      },
      {
        id: "C2",
        label:
          "Wie viele neue Patientinnen-Anfragen erreichen Sie aktuell ungefähr pro Monat (alle Wege zusammen)?",
        type: "auswahl",
        options: ["unter 10", "10-30", "30-60", "über 60", "weiß nicht"],
        required: true,
      },
      {
        id: "C3",
        label:
          "Fragt Ihr Team heute systematisch, wie Patientinnen auf Sie aufmerksam geworden sind?",
        type: "auswahl",
        options: ["ja, wird dokumentiert", "ja, aber nicht dokumentiert", "nein"],
        required: true,
      },
      {
        id: "C4",
        label: "Wie aktiv ist Ihr Instagram-Konto heute?",
        type: "auswahl",
        options: [
          "regelmäßig gepflegt",
          "sporadisch",
          "existiert, liegt brach",
          "existiert nicht",
        ],
        required: false,
      },
    ],
  },
  {
    key: "D",
    title: "Anfragen-Annahme und Beratung heute",
    why:
      "Bitte versuchen Sie, jede Anfrage innerhalb von 48 Werkstunden zu kontaktieren. Das ist keine Bedingung der Garantie. Schaffen Sie es nicht, hat das drei Folgen: Sie können bei dieser Anfrage nicht mehr einwenden, die Person sei nicht echt oder nicht erreichbar gewesen. Die Anfrage steht in Ihrer Auswertung als \"von der Praxis nicht beantwortet\". Und liegen drei oder mehr solcher Anfragen offen, dürfen wir nach einer Warnung die bezahlten Anzeigen pausieren, bis Sie die Anfragen kontaktiert haben. " +
      "Wir müssen wissen, wie das heute läuft, damit wir die Weiterleitung richtig bauen.",
    questions: [
      {
        id: "D1",
        label:
          "Wer nimmt heute Anfragen entgegen (Telefon, E-Mail, Instagram-Nachrichten)?",
        hint: "Name oder Rolle reicht.",
        type: "text",
        required: true,
      },
      {
        id: "D2",
        label: "Wie schnell wird eine neue Anfrage heute typischerweise beantwortet?",
        type: "auswahl",
        options: [
          "innerhalb von Stunden",
          "am selben Tag",
          "1-2 Tage",
          "länger",
          "unterschiedlich",
        ],
        required: true,
      },
      {
        id: "D3",
        label: "Wie läuft der Weg von der Anfrage zur Behandlung bei Ihnen?",
        hint: "Erst Telefonat, dann Beratungstermin? Direkt Termin? Beratungsgebühr ja/nein?",
        type: "textarea",
        required: true,
      },
      {
        id: "D4",
        label:
          "Schätzen Sie: Wie viele Ihrer Beratungsgespräche führen zu einer Behandlung?",
        type: "auswahl",
        options: ["unter 25 %", "25-50 %", "über 50 %", "weiß nicht"],
        required: true,
      },
      {
        id: "D5",
        label:
          "Schätzen Sie: Wie oft erscheinen Patientinnen nicht zum vereinbarten Termin?",
        type: "auswahl",
        options: [
          "praktisch nie",
          "ca. jede zehnte",
          "ca. jede fünfte",
          "häufiger",
          "weiß nicht",
        ],
        required: false,
      },
      {
        id: "D6",
        label: "Nutzen Sie eine Online-Terminbuchung (Doctolib o. ä.)?",
        hint: "Wenn ja, für welche Termine?",
        type: "text",
        required: true,
      },
    ],
  },
  {
    key: "E",
    title: "Einzugsgebiet und Wettbewerb",
    questions: [
      {
        id: "E1",
        label: "Aus welchem Umkreis kommen Ihre Patientinnen realistisch?",
        type: "auswahl",
        options: ["bis 15 km", "bis 30 km", "bis 50 km", "überregional"],
        required: true,
      },
      {
        id: "E2",
        label:
          "Welche 2 bis 3 Praxen in Ihrem Gebiet sehen Sie als direkten Wettbewerb?",
        hint: "Namen, gern ehrlich. Bleibt intern.",
        type: "text",
        required: true,
      },
      {
        id: "E3",
        label:
          "Spüren Sie Druck durch Discount-Anbieter oder Auslandsangebote (z. B. Ketten, Türkei)?",
        type: "auswahl",
        options: ["deutlich", "etwas", "kaum", "gar nicht"],
        required: false,
      },
    ],
  },
  {
    key: "F",
    title: "Rahmen und rote Linien",
    questions: [
      {
        id: "F1",
        label: "Welches monatliche Werbebudget haben Sie heute oder für später vorgesehen?",
        hint: "Freiwillig. Zu Beginn brauchen Sie kein Werbebudget, wir starten organisch. Das Werbebudget zahlen Sie direkt an Meta und Google, getrennt von der EINS-Gebühr.",
        type: "auswahl",
        options: [
          "kein Werbebudget zu Beginn",
          "bis 1.000 €",
          "1.000-2.500 €",
          "2.500-5.000 €",
          "über 5.000 €",
          "muss ich noch entscheiden",
        ],
        allowCustom: true,
        customLabel: "Oder eigener Betrag",
        required: false,
      },
      {
        id: "F2",
        label:
          "Gab es früher Abmahnungen, Kammer-Beschwerden oder rechtliche Themen rund um Ihre Werbung?",
        type: "auswahl",
        options: ["ja", "nein", "unsicher, dazu im Gespräch"],
        required: true,
      },
      {
        id: "F3",
        label:
          "Gibt es Aussagen oder Darstellungen, die für Sie in der Werbung nicht in Frage kommen, unabhängig von der Rechtslage?",
        type: "textarea",
        required: false,
      },
    ],
  },
];

/** Flat list of all questions, in display order. */
export const ALL_DISCOVERY_QUESTIONS: readonly DiscoveryQuestion[] =
  DISCOVERY_BLOCKS.flatMap((b) => b.questions);

export const DISCOVERY_QUESTIONS_BY_ID: ReadonlyMap<string, DiscoveryQuestion> =
  new Map(ALL_DISCOVERY_QUESTIONS.map((q) => [q.id, q]));

export const REQUIRED_DISCOVERY_IDS: readonly string[] =
  ALL_DISCOVERY_QUESTIONS.filter((q) => q.required).map((q) => q.id);

/** Stored answer shape: string for auswahl/text/textarea, string[] for mehrfach. */
export type DiscoveryAnswers = Record<string, string | string[]>;

/** True when the answer counts as "given" for the required-check on submit. */
export function isAnswered(value: string | string[] | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim().length > 0;
}

/** German thousands grouping without locale dependency: 1500 -> "1.500 €". */
export function formatBudgetEur(n: number): string {
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
}

/**
 * Parse a German-style euro amount to a whole-euro number, or null.
 * "1.500 €" -> 1500, "2000" -> 2000, "1.500,50 €" -> 1500 (cents dropped),
 * "2.000,-" -> 2000. Anything ambiguous is rejected instead of guessed:
 * ranges ("2000-3000"), English decimals ("1.5"), words ("ca. 3 Mio").
 */
export function parseEuroAmount(raw: string): number | null {
  const compact = raw
    .replace(/\s+/g, "")
    .replace(/(€|eur|euro)$/i, "")
    .replace(/,-{1,2}$/, "");
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.exec(compact);
  if (!m) return null;
  const n = Number.parseInt(m[1]!.replace(/\./g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Submit-time validation for free-entry budget answers. Returns the first
 * offending question id + message, or null when all custom values are fine.
 * Preset selections and empty values are skipped (the required-check owns the
 * empty case). There is no minimum amount (Werbebudget is not mandatory since
 * 2026-09-30); only a non-numeric value is rejected.
 */
export function customBudgetError(
  answers: DiscoveryAnswers
): { id: string; message: string } | null {
  for (const q of ALL_DISCOVERY_QUESTIONS) {
    if (!q.allowCustom) continue;
    const v = answers[q.id];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    if (q.options?.includes(trimmed)) continue;
    const eur = parseEuroAmount(trimmed);
    if (eur === null) {
      return {
        id: q.id,
        message:
          "Bitte geben Sie das Werbebudget als einen Betrag ein, zum Beispiel 2.000. Für eine Spanne wählen Sie oben eine der Stufen.",
      };
    }
  }
  return null;
}
