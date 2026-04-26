import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasOpenAI } from "@/lib/env";
import type { AiCategory } from "@/lib/constants";

/**
 * AI lead scorer.
 *
 * Two paths:
 *   1. OpenAI (when OPENAI_API_KEY is set) — small prompt + JSON-mode response
 *      with score 0..100 + category + one-line reasoning.
 *   2. Heuristic fallback — deterministic rules based on budget, treatment
 *      keywords, contact completeness. Purpose: dev parity + a reasonable
 *      answer when the model call fails.
 *
 * The score and category are stored directly on `requests`; we also write a
 * `request_activities` row with kind=ai_rescore so the timeline shows it.
 */

export interface AiScoreJob {
  requestId: string;
}

interface ScoreResult {
  score: number; // 0..100
  category: AiCategory;
  reasoning: string;
}

export async function processAiScore(job: AiScoreJob): Promise<void> {
  const { requestId } = job;

  const [req] = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1);
  if (!req) {
    console.warn(`[ai-score] request ${requestId} not found — skipping`);
    return;
  }

  let result: ScoreResult;
  if (hasOpenAI()) {
    try {
      result = await scoreWithOpenAI(req);
    } catch (err) {
      console.error("[ai-score] openai failed — falling back to heuristic:", err);
      result = scoreWithHeuristic(req);
    }
  } else {
    result = scoreWithHeuristic(req);
  }

  await db
    .update(schema.requests)
    .set({
      aiScore: result.score,
      aiCategory: result.category,
      aiReasoning: result.reasoning,
      aiPromptVersion: env.OPENAI_PROMPT_VERSION,
    })
    .where(eq(schema.requests.id, requestId));

  await db.insert(schema.requestActivities).values({
    requestId,
    kind: "ai_rescore",
    body: `${result.category.toUpperCase()} (${result.score}): ${result.reasoning}`,
    meta: { score: result.score, category: result.category },
  });
}

// ---------------------------------------------------------------
// Heuristic scorer
// ---------------------------------------------------------------
const HIGH_VALUE_TERMS = [
  "invisalign",
  "all-on-4",
  "allon4",
  "implant",
  "implantat",
  "botox",
  "filler",
  "aligner",
  "veneer",
  "bleaching",
];

function scoreWithHeuristic(
  req: typeof schema.requests.$inferSelect
): ScoreResult {
  let score = 40;
  const reasons: string[] = [];

  const wish = (req.treatmentWish ?? "").toLowerCase();
  const msg = (req.message ?? "").toLowerCase();
  const combined = `${wish} ${msg}`;

  if (HIGH_VALUE_TERMS.some((t) => combined.includes(t))) {
    score += 25;
    reasons.push("hochwertige Behandlung angefragt");
  }
  if (req.contactPhone && req.contactEmail) {
    score += 15;
    reasons.push("vollständige Kontaktdaten");
  } else if (!req.contactPhone && !req.contactEmail) {
    score -= 30;
    reasons.push("keine Kontaktdaten");
  }
  if (req.budgetIndication) {
    score += 10;
    reasons.push("Budget genannt");
  }
  if (req.source === "meta" || req.source === "google") {
    score += 5;
    reasons.push("bezahlte Anzeige");
  }
  if (combined.length > 300) {
    score += 5;
    reasons.push("ausführliche Nachricht");
  }
  if (combined.match(/\b(preis|gratis|kostenlos|günstig)\b/)) {
    score -= 10;
    reasons.push("preisorientiert");
  }

  score = Math.max(0, Math.min(100, score));
  const category: AiCategory = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";

  return {
    score,
    category,
    reasoning:
      reasons.length > 0
        ? reasons.join(", ")
        : "keine starken Signale — Standardbewertung",
  };
}

// ---------------------------------------------------------------
// OpenAI scorer
// ---------------------------------------------------------------
async function scoreWithOpenAI(
  req: typeof schema.requests.$inferSelect
): Promise<ScoreResult> {
  const payload = {
    treatmentWish: req.treatmentWish ?? null,
    budgetIndication: req.budgetIndication ?? null,
    message: req.message ?? null,
    source: req.source,
    hasPhone: Boolean(req.contactPhone),
    hasEmail: Boolean(req.contactEmail),
  };

  const systemPrompt = [
    "Du bewertest Patientenanfragen für Zahn- und Ästhetik-Kliniken in DACH.",
    "Antworte NUR mit JSON im Format:",
    `{"score": number 0..100, "category": "hot"|"warm"|"cold", "reasoning": "kurze deutsche Begründung"}`,
    "Heiß = wahrscheinlich hochwertige Behandlung. Warm = unklar. Kalt = Preis/Info.",
    "Beurteile Kaufabsicht und Behandlungswert, niemals medizinische Eignung.",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`openai http ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai empty response");

  const parsed = JSON.parse(content) as Partial<ScoreResult>;
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));
  const category: AiCategory =
    parsed.category === "hot" || parsed.category === "warm" || parsed.category === "cold"
      ? parsed.category
      : score >= 70
      ? "hot"
      : score >= 40
      ? "warm"
      : "cold";
  const reasoning = String(parsed.reasoning ?? "").slice(0, 400) || "(kein Text)";
  return { score, category, reasoning };
}
