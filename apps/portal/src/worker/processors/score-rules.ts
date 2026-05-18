import type { AiCategory } from "@/lib/constants";
import type { LeadQuiz } from "@/server/leads";
import { tierBasePoints, type TreatmentCategory } from "./treatment-tiers";

/**
 * Rule-based lead scorer for the clinic-landing pre-qualifier form.
 *
 * Replaces the OpenAI path for `source="formular"` intake — we have
 * structured answers, so heuristic > LLM in both accuracy and cost. The
 * OpenAI / heuristic path is kept alive in ai-score.ts for manual /
 * WhatsApp / paid-ad sources that don't carry quiz data.
 *
 * Point table (theoretical max 105, clamped to 100):
 *   - Treatment value          0..24  (tier × specificity)
 *   - Timeframe                0..24
 *   - Distance to praxis       0..24
 *   - Phone (validated)        0 or 9
 *   - Experience               0..9   (4 when not asked)
 *   - Notes intent             0..15  (LLM-scored; falls back to 0/7 rule)
 *
 * Notes are scored by an LLM (gpt-4o-mini) reading the free-text field for
 * purchase intent. The caller (ai-score.ts) computes the points + reasoning
 * and passes them in; this module stays deterministic given its inputs. When
 * the LLM is unavailable, the caller falls back to the legacy
 * `notesAreSubstantive ? 5 : 0` rule, which is exported below.
 *
 * Marketing consent is intentionally NOT scored — newsletter opt-in is not
 * purchase intent, and earlier versions of this scorer let it swing leads
 * across the hot/warm boundary.
 *
 * Category bands: hot ≥ 70, warm 40..69, cold < 40.
 *
 * info-only branch override: regardless of points, force category=cold and
 * clamp the score to ≤ 39. info-only patients self-identified as not ready;
 * we want them visible in the queue (so the praxis sees demand) but never
 * surfacing as a hot lead. In practice the info-only path skips the city +
 * phone + experience steps, so its structural max is ≈ 30 — the clamp is
 * defensive insurance against future quiz changes.
 */

export interface ScoreFromQuizInput {
  quiz: LeadQuiz;
  /** Distance in km from the lead's city to the clinic's primary location, or null if unknown. */
  distanceKm: number | null;
  /** Raw phone string from the request row; validated here, not by the form. */
  contactPhone?: string | null;
  /**
   * Notes-intent points (0..10) computed by the LLM or the deterministic
   * fallback. The caller in ai-score.ts decides which path produced this.
   */
  notesIntentPoints: number;
  /**
   * Short German reasoning string from whichever path computed
   * `notesIntentPoints` ("KI: …" for LLM, "Notizen substantiell"/"keine Notizen"
   * for the rule fallback). Surfaced verbatim in `aiReasoning`.
   */
  notesIntentReasoning: string;
}

export interface ScoreBreakdown {
  treatment: number;
  timeframe: number;
  distance: number;
  phone: number;
  experience: number;
  notes: number;
}

export interface ScoreResult {
  score: number;
  category: AiCategory;
  reasoning: string;
  breakdown: ScoreBreakdown;
}

/**
 * Treatment-value scoring: tier base × specificity modifier, clamped [4, 24].
 *
 *   - Specific procedure selected → +5 (knows what they want — strongest signal)
 *   - "kombination"               → +3 (genuine bundle interest)
 *   - "unsicher"                  → −3 (still in consideration mode)
 */
function treatmentValuePoints(
  category: TreatmentCategory | string | undefined,
  selection: string,
): { pts: number; label: string } {
  const base = tierBasePoints(category);
  const sel = selection.trim().toLowerCase();

  let modifier: number;
  let modLabel: string;
  if (sel === "kombination") {
    modifier = 3;
    modLabel = "Kombination";
  } else if (sel === "unsicher") {
    modifier = -3;
    modLabel = "unsicher";
  } else {
    modifier = 5;
    modLabel = selection || "spezifisch";
  }

  let pts = base + modifier;
  if (pts > 24) pts = 24;
  if (pts < 4) pts = 4;

  const catLabel = category ?? "unbekannt";
  return { pts, label: `${catLabel}/${modLabel}` };
}

function timeframePoints(tf: LeadQuiz["timeframe"]): { pts: number; label: string } {
  switch (tf) {
    case "asap":
      return { pts: 24, label: "asap" };
    case "this-month":
      return { pts: 21, label: "diesen Monat" };
    case "next-3-months":
      return { pts: 13, label: "nächste 3 Monate" };
    case "later":
      return { pts: 4, label: "später" };
    case "info-only":
      return { pts: 0, label: "nur Info" };
    default:
      return { pts: 0, label: "unklar" };
  }
}

function distancePoints(km: number | null): { pts: number; label: string } {
  if (km === null) return { pts: 0, label: "unbekannt" };
  const rounded = Math.round(km);
  if (km < 15) return { pts: 24, label: `${rounded}km` };
  if (km < 40) return { pts: 17, label: `${rounded}km` };
  if (km < 100) return { pts: 9, label: `${rounded}km` };
  if (km < 300) return { pts: 4, label: `${rounded}km` };
  return { pts: 0, label: `${rounded}km` };
}

/**
 * 9 pts if `had-this`, 6 if `had-similar`, 2 if `first`, 4 (neutral) when
 * the treatment didn't ask the question. Neutral default keeps treatments
 * with `askExperience: false` from being penalised relative to surgical ones.
 */
function experiencePoints(exp: LeadQuiz["experience"]): { pts: number; label: string } {
  switch (exp) {
    case "had-this":
      return { pts: 9, label: "hatte gleiche" };
    case "had-similar":
      return { pts: 6, label: "ähnliche Erfahrung" };
    case "first":
      return { pts: 2, label: "erstes Mal" };
    case undefined:
      return { pts: 4, label: "nicht gefragt" };
    default:
      return { pts: 4, label: "unklar" };
  }
}

/**
 * Award the 10 phone points only when the digits look real:
 *   - at least 8 digits (German fixed line is 8, mobile 10–11)
 *   - not a repeated single digit (rejects 00000000, 11111111, etc.)
 */
function phoneValid(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  return true;
}

/**
 * Deterministic fallback for the notes bucket when the LLM scorer is
 * unavailable (no API key, parse error, network failure).
 *
 * Length-only checks are easy to game ("asdfasdfasdfasdf"). Require at least
 * two whitespace-separated 4+ letter words so the bonus rewards real content.
 * Real notes are virtually always multi-word; keystroke spam usually isn't.
 */
export function notesAreSubstantive(notes: string | undefined): boolean {
  if (!notes) return false;
  const t = notes.trim();
  if (t.length < 20) return false;
  const wordRx = /^[A-Za-zÄÖÜäöüß]{4,}$/;
  const realWords = t.split(/\s+/).filter((w) => wordRx.test(w));
  return realWords.length >= 2;
}

export function scoreFromQuiz(input: ScoreFromQuizInput): ScoreResult {
  const { quiz, distanceKm, contactPhone, notesIntentPoints, notesIntentReasoning } = input;

  const treatment = treatmentValuePoints(quiz.treatmentCategory, quiz.treatmentSelection);
  const timeframe = timeframePoints(quiz.timeframe);
  const distance = distancePoints(distanceKm);
  const experience = experiencePoints(quiz.experience);

  const phonePts = quiz.hasPhone && phoneValid(contactPhone) ? 9 : 0;
  // Clamp defensively: the LLM is contractually 0..15 but bad JSON happens.
  const notesPts = Math.max(0, Math.min(15, Math.round(notesIntentPoints)));

  let score =
    treatment.pts +
    timeframe.pts +
    distance.pts +
    phonePts +
    experience.pts +
    notesPts;

  // Safety clamp — buckets sum to a theoretical 105 (LLM contributes up to 15).
  score = Math.max(0, Math.min(100, score));

  // info-only branch overrides everything below.
  const forcedCold = quiz.branch === "info-only";
  if (forcedCold && score > 39) score = 39;

  const category: AiCategory = forcedCold
    ? "cold"
    : score >= 70
    ? "hot"
    : score >= 40
    ? "warm"
    : "cold";

  const reasoning = [
    `Behandlung ${treatment.pts} (${treatment.label})`,
    `Zeitfenster ${timeframe.pts} (${timeframe.label})`,
    `Distanz ${distance.pts} (${distance.label})`,
    `Telefon ${phonePts}`,
    `Erfahrung ${experience.pts} (${experience.label})`,
    `Notizen ${notesPts} (${notesIntentReasoning})`,
    `= ${score} (${category}${forcedCold ? ", info-only" : ""})`,
  ].join(", ");

  return {
    score,
    category,
    reasoning,
    breakdown: {
      treatment: treatment.pts,
      timeframe: timeframe.pts,
      distance: distance.pts,
      phone: phonePts,
      experience: experience.pts,
      notes: notesPts,
    },
  };
}
