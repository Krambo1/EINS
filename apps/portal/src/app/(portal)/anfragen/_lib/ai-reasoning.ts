import type { AiCategory } from "@/lib/constants";
import { aiCategoryWord } from "./ai-score";

/**
 * The scorer stores `aiReasoning` (and the `ai_rescore` activity body) with
 * raw codes ("Zeitfenster 24 (asap)", "= 74 (hot, info-only)", "Tier rhino
 * (+20)", "COLD (32): ...", "Score 80 (hot): ..."). Map them to German when
 * rendering (C-32, DN1); stored rows stay unchanged. Band words are the
 * list's own ("gute / mittlere / geringe Passung", `ai-score.ts`). Free text
 * (LLM notes verdict, the patient's own treatment selection) passes through.
 */
const TREATMENT_CATEGORY_LABELS: Record<string, string> = {
  botox: "Botox",
  filler: "Hyaluron-Filler",
  "lid-op": "Lid-OP",
  liposuktion: "Liposuktion",
  brust: "Brust",
  rhino: "Nase",
  "anti-aging": "Verjüngung",
  skin: "Haut",
  other: "Sonstiges",
};

function categoryLabel(slug: string): string {
  return TREATMENT_CATEGORY_LABELS[slug] ?? slug;
}

function bandWord(category: string): string {
  return aiCategoryWord(category.toLowerCase() as AiCategory) ?? category;
}

export function germanAiReasoning(text: string): string {
  return (
    text
      // Activity body prefix "COLD (32): ..." and seed text "Score 80 (hot): ...".
      .replace(/^(HOT|WARM|COLD) \((\d+)\): /, (_m, cat: string, score: string) =>
        `${score} von 100, ${bandWord(cat)}: `
      )
      .replace(/^Score (\d+) \((hot|warm|cold)\): /, (_m, score: string, cat: string) =>
        `${score} von 100, ${bandWord(cat)}: `
      )
      // "Behandlung 22 (rhino/Kombination)": category slug before the slash.
      .replace(
        /(Behandlung \d+ \()([a-z-]+)(\/)/g,
        (_m, pre: string, slug: string, slash: string) => `${pre}${categoryLabel(slug)}${slash}`
      )
      // Heuristic path: "Tier rhino (+20)".
      .replace(/\bTier ([a-z-]+) \(/g, (_m, slug: string) =>
        `Behandlung ${categoryLabel(slug)} (`
      )
      .replace(/\(asap\)/g, "(so schnell wie möglich)")
      .replace(/, info-only\)/g, ", nur Info)")
      .replace(/= (-?\d+) \((hot|warm|cold)\b/g, (_m, score: string, cat: string) =>
        `= ${score} (${bandWord(cat)}`
      )
      // Older fallback text carried an em-dash.
      .replace(/ — /g, ", ")
  );
}
