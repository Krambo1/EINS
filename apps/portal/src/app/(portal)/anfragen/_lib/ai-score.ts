/**
 * KI-Bewertung in Worten (DS3). The bands are the scorer's own
 * (`worker/processors/score-rules.ts`: hot >= 70, warm 40..69, cold < 40),
 * so the word next to the number always matches the stored category.
 *
 * Wording rule (KANON 5): the score only helps sorting. It never decides
 * whether an Anfrage counts, so no text here may sound like a verdict.
 */
export type AiScoreBand = "gut" | "mittel" | "gering";

export function aiScoreBand(score: number): AiScoreBand {
  if (score >= 70) return "gut";
  if (score >= 40) return "mittel";
  return "gering";
}

const BAND_WORDS: Record<AiScoreBand, string> = {
  gut: "gute Passung",
  mittel: "mittlere Passung",
  gering: "geringe Passung",
};

export function aiScoreWord(score: number): string {
  return BAND_WORDS[aiScoreBand(score)];
}

/** "74/100". The band shows in the badge colour; the words are in the explanation. */
export function aiScoreText(score: number): string {
  return `${score}/100`;
}

/** Badge tone per band, same colours the category badges used before. */
export function aiScoreTone(score: number): "accent" | "warn" | "neutral" {
  const band = aiScoreBand(score);
  return band === "gut" ? "accent" : band === "mittel" ? "warn" : "neutral";
}

/** One explanation for popover and `title`, used wherever the score appears. */
export const AI_SCORE_EXPLANATION =
  "Die KI-Bewertung schätzt aus den Angaben der Anfrage (Behandlungswunsch, Zeitrahmen, Anfahrtsweg, Kontaktdaten), wie gut sie zu Ihrer Praxis passt. 70 bis 100 heißt gute Passung, 40 bis 69 mittlere, unter 40 geringe. Sie hilft nur beim Sortieren und entscheidet nie, ob eine Anfrage zählt. Bitte melden Sie sich bei jeder Anfrage.";

/** Old rows with a category but no number: same words, no scale. */
export function aiCategoryWord(category: string | null | undefined): string | null {
  if (category === "hot") return BAND_WORDS.gut;
  if (category === "warm") return BAND_WORDS.mittel;
  if (category === "cold") return BAND_WORDS.gering;
  return null;
}
