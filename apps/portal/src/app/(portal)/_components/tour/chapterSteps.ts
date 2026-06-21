import type { TourStep } from "./types";

/**
 * On-demand deep-dive chapters. Each goes one level deeper than the core tour
 * into a single area, in plain value-framed Sie-German. Launched from the
 * Einstellungen hub or a per-page "Kurz erklärt" link, never auto-shown, and
 * (unlike the core tour) they do NOT record onboarding completion.
 *
 * Empty-state safety: chapters anchor on always-present page chrome (headers,
 * filter bars, the section cards). Steps that spotlight data-dependent content
 * (a connected platform card, a list of real requests) are marked
 * `skipIfMissing` so they fall through on a fresh account instead of showing a
 * card pointed at nothing. Every chapter ends with a centered finish card, so
 * it closes cleanly even when the middle steps were all skipped.
 *
 * Deliberately NOT covered: per-item detail pages (`/anfragen/[id]` etc.) need
 * a real record to navigate to, which would break on an empty account.
 */

export type ChapterKey = "anfragen" | "werbebudget" | "bewertungen";

export interface TourChapter {
  key: ChapterKey;
  /** Short label for the hub list and the per-page link. */
  label: string;
  /** One line for the hub list, under the label. */
  description: string;
  steps: TourStep[];
}

/** Shared closing card. Points back at the hub so chapters stay re-findable. */
function finishStep(area: string): TourStep {
  return {
    title: `Das war der Bereich ${area}`,
    body: "Diesen und weitere Rundgänge können Sie jederzeit in den Einstellungen unter Portal-Rundgang erneut starten.",
  };
}

const ANFRAGEN: TourChapter = {
  key: "anfragen",
  label: "Anfragen verstehen",
  description: "Filter, KI-Bewertung und der Weg zur einzelnen Anfrage.",
  steps: [
    {
      route: "/anfragen",
      element: '[data-tour="anfragen-filters"]',
      title: "Schnell die richtige Anfrage finden",
      body: "Suchen, filtern und sortieren Sie nach Status, Quelle oder Behandlung. So haben Sie auch bei vielen Anfragen in Sekunden die im Blick, die gerade zählen.",
      side: "bottom",
      align: "start",
    },
    {
      element: '[data-tour="anfragen-ki"]',
      title: "Die heißen Anfragen erkennt der Filter",
      body: "Jede Anfrage bekommt automatisch eine Einschätzung, von sehr heiß bis kalt. Ihr Team ruft die ernsthaften Interessenten zuerst an, ohne lange zu sichten.",
      side: "bottom",
      align: "start",
    },
    {
      element: '[data-tour="anfragen-list"]',
      title: "Alles zu einer Anfrage an einem Ort",
      body: "Ein Klick öffnet die ganze Anfrage: Kontaktdaten, bisheriger Verlauf und der nächste Schritt. So geht auch im Team nichts verloren.",
      side: "top",
      align: "center",
      skipIfMissing: true,
    },
    finishStep("Anfragen"),
  ],
};

const WERBEBUDGET: TourChapter = {
  key: "werbebudget",
  label: "Werbebudget verstehen",
  description: "Budget, Ergebnis je Kanal und wie ehrlich die Zahlen sind.",
  steps: [
    {
      route: "/werbebudget",
      element: '[data-tour="werbebudget-totals"]',
      title: "Das Wichtigste auf einen Blick",
      body: "Was Sie investiert haben, wie viele Anfragen daraus wurden und was eine Anfrage im Schnitt gekostet hat. Drei Zahlen, kein Rätselraten.",
      side: "bottom",
      align: "center",
      skipIfMissing: true,
    },
    {
      element: '[data-tour="werbebudget-platforms"]',
      title: "Meta und Google getrennt",
      body: "So sehen Sie, welcher Kanal besser für Sie arbeitet, und können das Budget dorthin lenken, wo es sich lohnt.",
      side: "top",
      align: "center",
      skipIfMissing: true,
    },
    {
      element: '[data-tour="werbebudget-method"]',
      title: "Ehrliche Zahlen, klar erklärt",
      body: "Wir zählen nur echte Anfragen aus Ihrem Posteingang, keine bloßen Klicks. Kleine Abweichungen zu Meta und Google sind normal und hier kurz erklärt.",
      side: "top",
      align: "center",
    },
    finishStep("Werbebudget"),
  ],
};

const BEWERTUNGEN: TourChapter = {
  key: "bewertungen",
  label: "Bewertungen verstehen",
  description: "Sterne, fertige Antwortvorlagen und das private Feedback-Postfach.",
  steps: [
    {
      route: "/bewertungen",
      element: '[data-tour="bewertungen-platforms"]',
      title: "Ihre Sterne an einem Ort",
      body: "Google, Jameda und Co. zusammengeführt. So sehen Sie Ihre Reputation auf einen Blick, ohne jede Plattform einzeln zu prüfen.",
      side: "top",
      align: "center",
    },
    {
      element: '[data-tour="bewertungen-templates"]',
      title: "Fertige, rechtssichere Antworten",
      body: "Vorformulierte Vorlagen zum Kopieren, von Dank bis Beschwerde. Platzhalter ersetzen, einfügen, fertig.",
      side: "top",
      align: "center",
    },
    {
      route: "/bewertungen/feedback",
      element: '[data-tour="feedback-header"]',
      title: "Kritik kommt zuerst zu Ihnen",
      body: "Zufriedene Patienten leiten wir zu Google und Jameda. Kritische Rückmeldungen landen zuerst privat hier, bevor sie öffentlich werden.",
      side: "bottom",
      align: "start",
    },
    finishStep("Bewertungen"),
  ],
};

export const CHAPTERS: Record<ChapterKey, TourChapter> = {
  anfragen: ANFRAGEN,
  werbebudget: WERBEBUDGET,
  bewertungen: BEWERTUNGEN,
};

/** Display order for the Einstellungen hub. */
export const CHAPTER_LIST: TourChapter[] = [ANFRAGEN, WERBEBUDGET, BEWERTUNGEN];
