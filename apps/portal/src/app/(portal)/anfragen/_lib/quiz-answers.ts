/**
 * Patient answers from the Zielseiten-Quiz (`ai_signals.quiz`), as short
 * German lines for the Anfrage detail and the call card (C-26). The values
 * mirror the option ids in clinic-landing `pre-qualifier/types.ts`; unknown
 * values are shown as sent instead of being dropped.
 */

const TIMEFRAME: Record<string, string> = {
  asap: "So bald wie möglich",
  "this-month": "Diesen Monat",
  "next-3-months": "In den nächsten 3 Monaten",
  later: "Später",
  "info-only": "Möchte sich erst informieren",
};

const BUDGET: Record<string, string> = {
  ja: "Investitionsrahmen passt",
  unsicher: "Investitionsrahmen unsicher",
  "erst-informieren": "Möchte erst mehr erfahren",
};

const DISTANCE: Record<string, string> = {
  "in-der-naehe": "Wohnt in der Nähe",
  "bis-1-stunde": "Bis zu 1 Stunde entfernt",
  "weiter-entfernt": "Weiter entfernt",
};

export interface QuizAnswerLine {
  label: string;
  value: string;
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export function quizAnswerLines(quiz: Record<string, unknown> | null | undefined): QuizAnswerLine[] {
  if (!quiz) return [];
  const out: QuizAnswerLine[] = [];
  const timeframe = text(quiz.timeframe);
  if (timeframe) out.push({ label: "Zeitrahmen", value: TIMEFRAME[timeframe] ?? timeframe });
  const budget = text(quiz.budget);
  if (budget) out.push({ label: "Budget", value: BUDGET[budget] ?? budget });
  const distance = text(quiz.distance);
  if (distance) out.push({ label: "Anfahrt", value: DISTANCE[distance] ?? distance });
  const city = text(quiz.city);
  if (city) out.push({ label: "Ort", value: city });
  const experience = text(quiz.experience);
  if (experience) out.push({ label: "Vorerfahrung", value: experience });
  // The info branch is already visible through the timeframe/budget answer;
  // only add it when neither of those says so.
  if (
    text(quiz.branch) === "info-only" &&
    timeframe !== "info-only" &&
    budget !== "erst-informieren"
  ) {
    out.push({ label: "Anliegen", value: "Möchte sich erst informieren" });
  }
  return out;
}
