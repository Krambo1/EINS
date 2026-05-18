/**
 * Leitfaden-Prüfung — statische Frage-Bank.
 *
 * Quelle ausschließlich: apps/portal/src/app/(portal)/leitfaden/page.tsx.
 * 10 Fragen, je 4 Optionen, eine korrekt.
 *
 * Bestehen ab `PASS_THRESHOLD` richtig (= 9/10 = 90 %).
 *
 * Wird die Frage-Bank inhaltlich geändert (Reihenfolge ist Cosmetic), den
 * Wert von `CURRENT_QUESTIONS_VERSION` hochziehen — bereits bestandene
 * Mitarbeiter:innen müssen dann erneut bestehen.
 */

export const CURRENT_QUESTIONS_VERSION = 1;
export const PASS_THRESHOLD = 9;

export interface QuizOption {
  /** Stable id used as the radio value. */
  id: string;
  label: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: [QuizOption, QuizOption, QuizOption, QuizOption];
  /** Index 0..3 — never sent to the client; used server-side for scoring. */
  correctIndex: 0 | 1 | 2 | 3;
  /** Shown on a wrong answer in the result screen — pointer back to the source. */
  sourceHint: string;
}

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: "q1-reaktionszeit",
    prompt:
      "Was ist die Ziel-Reaktionszeit ab Eingang einer neuen Anfrage?",
    options: [
      { id: "a", label: "Bis Ende des Werktages" },
      { id: "b", label: "Unter 5 Minuten" },
      { id: "c", label: "Unter 15 Minuten" },
      { id: "d", label: "Unter 1 Stunde" },
    ],
    correctIndex: 1,
    sourceHint: "Abschnitt „KPI-Ziele für jeden Anruf“ — Reaktionszeit.",
  },
  {
    id: "q2-preisfrage",
    prompt:
      "Eine Patientin fragt am Telefon: „Was kostet das genau?“ Was antworten Sie?",
    options: [
      {
        id: "a",
        label:
          "Den günstigsten erfahrungsbasierten Preis nennen, damit sie nicht abspringt.",
      },
      {
        id: "b",
        label:
          "Antworten: „Das kann ich Ihnen am Telefon nicht sagen.“ und das Thema wechseln.",
      },
      {
        id: "c",
        label:
          "Eine grobe Spanne nennen, auf die Beratungsgebühr hinweisen und erklären, dass der verbindliche Kostenvoranschlag durch den Arzt nach der Untersuchung erstellt wird.",
      },
      { id: "d", label: "Einen Pauschalpreis aus der Preisliste ablesen." },
    ],
    correctIndex: 2,
    sourceHint:
      "Goldene Prinzipien #2 + Eröffnungs-Skript „Patient fragt sofort den Preis“ + Einwand A3.",
  },
  {
    id: "q3-termin-angebot",
    prompt:
      "Mit welcher Formulierung schließen Sie eine Antwort auf einen Einwand ab?",
    options: [
      { id: "a", label: "„Wollen Sie einen Termin?“" },
      {
        id: "b",
        label:
          "„Donnerstag oder eher nächste Woche?“ — zwei konkrete Termin-Vorschläge",
      },
      {
        id: "c",
        label:
          "„Melden Sie sich gerne, wenn Sie sich entschieden haben.“",
      },
      {
        id: "d",
        label: "„Schauen Sie auf unsere Website, dort können Sie buchen.“",
      },
    ],
    correctIndex: 1,
    sourceHint:
      "Goldene Prinzipien #3 — „Eine Antwort, ein Termin-Angebot“.",
  },
  {
    id: "q4-einwand-reihenfolge",
    prompt:
      "In welcher Reihenfolge beantworten Sie einen Patienten-Einwand?",
    options: [
      { id: "a", label: "Widerlegen → Vorteile aufzählen → drängen" },
      { id: "b", label: "Anerkennen → reframen → Termin anbieten" },
      {
        id: "c",
        label: "Termin anbieten → Einwand ignorieren → nachfassen",
      },
      { id: "d", label: "An den Arzt verweisen → auflegen" },
    ],
    correctIndex: 1,
    sourceHint:
      "Goldene Prinzipien #1 — „Anerkennen, reframen, Termin anbieten“.",
  },
  {
    id: "q5-medizinische-fragen",
    prompt:
      "Wer darf Diagnosen, Risiken oder konkrete Behandlungs­methoden am Telefon kommunizieren?",
    options: [
      {
        id: "a",
        label:
          "Jede:r geschulte Mitarbeiter:in, solange der Leitfaden gelesen wurde.",
      },
      {
        id: "b",
        label:
          "Die Empfangsleitung mit mindestens 2 Jahren Berufserfahrung.",
      },
      { id: "c", label: "Nur der Arzt / die Ärztin im Beratungstermin." },
      {
        id: "d",
        label:
          "Mitarbeiter:innen dürfen Standard-Antworten geben, aber keine seltenen Risiken.",
      },
    ],
    correctIndex: 2,
    sourceHint:
      "Quelle:Goldene Prinzipien #5 + § 7 Abs. 4 MBO-Ä, § 1 HeilprG + Einwand B5.",
  },
  {
    id: "q6-stille",
    prompt:
      "Wie lange schweigen Sie nach einem konkreten Termin-Vorschlag, bevor Sie nachschieben?",
    options: [
      { id: "a", label: "0 Sekunden — sofort eine zweite Option anbieten" },
      { id: "b", label: "1 Sekunde" },
      { id: "c", label: "3 Sekunden" },
      { id: "d", label: "10 Sekunden" },
    ],
    correctIndex: 2,
    sourceHint:
      "Quelle:Goldene Prinzipien #6 — „Stille aushalten“.",
  },
  {
    id: "q7-abschlussquote",
    prompt:
      "Wie hoch ist die Ziel-Abschlussquote aus Beratungsterminen?",
    options: [
      { id: "a", label: "Über 10 %" },
      { id: "b", label: "Über 25 %" },
      { id: "c", label: "Über 50 %" },
      { id: "d", label: "Über 80 %" },
    ],
    correctIndex: 1,
    sourceHint:
      "Abschnitt „KPI-Ziele für jeden Anruf“ — Abschlussquote.",
  },
  {
    id: "q8-spiegeln",
    prompt:
      "Welche Formulierung passt zur Spiegeln-Regel im Vertriebsleitfaden?",
    options: [
      { id: "a", label: "„Aber das ist eine super Investition …“" },
      { id: "b", label: "„Ich verstehe, dass …“" },
      { id: "c", label: "„Nein, das stimmt so nicht, weil …“" },
      { id: "d", label: "„Sie müssen das anders sehen …“" },
    ],
    correctIndex: 1,
    sourceHint:
      "Quelle:Goldene Prinzipien #4 — „Spiegeln statt widerlegen“.",
  },
  {
    id: "q9-rote-flaggen",
    prompt:
      "Bei welcher der folgenden Patient:innen vereinbaren Sie keinen Beratungstermin?",
    options: [
      {
        id: "a",
        label:
          "Eine Patientin, die seit Wochen recherchiert und nun zwischen zwei Praxen vergleicht.",
      },
      {
        id: "b",
        label:
          "Ein Patient, der den Termin verschieben möchte, weil er beruflich eingebunden ist.",
      },
      {
        id: "c",
        label:
          "Eine Anruferin, die für ihre 16-jährige Tochter einen Termin vereinbaren möchte.",
      },
      {
        id: "d",
        label:
          "Eine Patientin, die nach einer schlechten Erfahrung in einer anderen Praxis wechselt.",
      },
    ],
    correctIndex: 2,
    sourceHint:
      "Quelle:Discovery-Block „Rote Flaggen, bei denen kein Termin vereinbart wird“.",
  },
  {
    id: "q10-vor-dem-anruf",
    prompt:
      "Welcher der folgenden Punkte gehört NICHT zur 30-Sekunden-Vorbereitung vor einem Anruf?",
    options: [
      {
        id: "a",
        label:
          "Anrufer-Profil aus der KI-Bewertung öffnen (Heiß, Warm, Kalt)",
      },
      {
        id: "b",
        label:
          "Notiz-Block bereithalten: Name, Geburtsdatum, Mobilnummer, E-Mail, PLZ, Behandlungs-Interesse, bevorzugter Kanal, Empfehlungsquelle",
      },
      {
        id: "c",
        label: "Stimme hochbringen, leise Umgebung sicherstellen",
      },
      {
        id: "d",
        label:
          "Budget-Range aus dem CRM raussuchen und am Telefon direkt abfragen",
      },
    ],
    correctIndex: 3,
    sourceHint:
      "Quelle:Abschnitt „Vor jedem Anruf in 30 Sekunden“ + Discovery-Block C („Niemals direkt fragen ‚Wie viel können Sie ausgeben?‘“).",
  },
] as const;

export const TOTAL_QUESTIONS = QUIZ_QUESTIONS.length;

/** Public-facing question shape — strips the correct index. */
export interface PublicQuestion {
  id: string;
  prompt: string;
  options: readonly QuizOption[];
}

export const PUBLIC_QUESTIONS: readonly PublicQuestion[] = QUIZ_QUESTIONS.map(
  (q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, label: o.label })),
  })
);

/** Look up the source hint for a wrong answer, given the question id. */
export function sourceHintFor(questionId: string): string | undefined {
  return QUIZ_QUESTIONS.find((q) => q.id === questionId)?.sourceHint;
}
