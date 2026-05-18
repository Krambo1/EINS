import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasOpenAI } from "@/lib/env";
import type { AiCategory } from "@/lib/constants";
import type { LeadQuiz } from "@/server/leads";
import { geocode } from "@/server/geocode/nominatim";
import { distanceKm, type LatLng } from "@/server/geocode/haversine";
import { notesAreSubstantive, scoreFromQuiz } from "./score-rules";
import { inferCategoryFromText, tierBasePoints } from "./treatment-tiers";

/**
 * AI lead scorer.
 *
 * Three paths, picked in this order:
 *   1. Rule-based quiz scorer + LLM notes scorer (the primary path for
 *      clinic-landing form intake). Deterministic rules score treatment,
 *      timeframe, distance, phone, experience; an OpenAI call (gpt-4o-mini)
 *      scores the free-text notes field 0..15 for purchase intent. The LLM
 *      output is the single "AI-assisted" step that makes the pipeline
 *      genuinely AI-augmented and is surfaced in `aiReasoning`. Falls back
 *      to a deterministic notes rule if no API key or the call fails;
 *      `aiPromptVersion` records which path ran ("rules-v3-llm-notes" vs
 *      "rules-v2").
 *   2. OpenAI full-lead scorer (when OPENAI_API_KEY is set AND there is no
 *      structured quiz data — manual / WhatsApp / paid-ad intake).
 *   3. Heuristic fallback — deterministic rules based on budget, treatment
 *      keywords, contact completeness. Used when neither quiz data nor an
 *      API key is available.
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

  // Rule-based path for clinic-landing pre-qualifier intake. We have the
  // patient's structured answers in `ai_signals.quiz`, so heuristic > LLM.
  const quiz = extractQuiz(req.aiSignals);

  let result: ScoreResult;
  let promptVersion = env.OPENAI_PROMPT_VERSION;

  if (quiz) {
    const rulesOut = await scoreWithRules(req.clinicId, quiz, req.contactPhone);
    result = rulesOut.result;
    promptVersion = rulesOut.promptVersion;
  } else if (hasOpenAI()) {
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
      aiPromptVersion: promptVersion,
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
// Rule-based scorer plumbing — geocode the clinic + the lead's city,
// compute distance, hand off to scoreFromQuiz.
// ---------------------------------------------------------------

function extractQuiz(aiSignals: unknown): LeadQuiz | null {
  if (!aiSignals || typeof aiSignals !== "object") return null;
  const quiz = (aiSignals as { quiz?: unknown }).quiz;
  if (!quiz || typeof quiz !== "object") return null;
  // Loose runtime check — the route already Zod-validated this. We just
  // protect against legacy rows or hand-poked data in ai_signals.
  const q = quiz as Partial<LeadQuiz>;
  if (typeof q.branch !== "string") return null;
  if (typeof q.treatmentSelection !== "string") return null;
  return quiz as LeadQuiz;
}

async function scoreWithRules(
  clinicId: string,
  quiz: LeadQuiz,
  contactPhone: string | null
): Promise<{ result: ScoreResult; promptVersion: string }> {
  const clinicCoords = await getPrimaryLocationCoords(clinicId);
  const leadCoords = quiz.city ? await geocode(quiz.city) : null;

  const km =
    clinicCoords && leadCoords ? distanceKm(clinicCoords, leadCoords) : null;

  // Notes bucket: LLM scores the free-text field for purchase intent. This
  // is the single LLM inference step that makes the pipeline genuinely
  // "AI-assisted" — the rest of the scoring stays deterministic. We only
  // call OpenAI when the patient gave explicit AI-processing consent on the
  // form (Art. 9 / Art. 22 / Art. 49 DSGVO); without it we use the
  // deterministic substantive-notes rule. On LLM failure we fall back to the
  // same rule. `aiPromptVersion` stamps which path actually ran.
  const trimmedNotes = quiz.notes?.trim() ?? "";
  const aiConsent = quiz.aiProcessingConsent === true;
  let notesIntentPoints: number;
  let notesIntentReasoning: string;
  let llmRan = false;

  if (trimmedNotes.length === 0) {
    notesIntentPoints = 0;
    notesIntentReasoning = "keine Notizen";
  } else if (!aiConsent) {
    const substantive = notesAreSubstantive(trimmedNotes);
    notesIntentPoints = substantive ? 7 : 0;
    notesIntentReasoning = substantive
      ? "Notizen substantiell (ohne KI-Einwilligung)"
      : "Notizen zu kurz (ohne KI-Einwilligung)";
  } else if (hasOpenAI()) {
    try {
      const llm = await scoreNotesWithOpenAI(trimmedNotes);
      notesIntentPoints = llm.points;
      notesIntentReasoning = `KI: ${llm.reasoning}`;
      llmRan = true;
    } catch (err) {
      console.error("[ai-score] notes-llm failed — falling back to rule:", err);
      const substantive = notesAreSubstantive(trimmedNotes);
      notesIntentPoints = substantive ? 7 : 0;
      notesIntentReasoning = substantive ? "Notizen substantiell (Regel-Fallback)" : "Notizen zu kurz (Regel-Fallback)";
    }
  } else {
    const substantive = notesAreSubstantive(trimmedNotes);
    notesIntentPoints = substantive ? 7 : 0;
    notesIntentReasoning = substantive ? "Notizen substantiell" : "Notizen zu kurz";
  }

  const { score, category, reasoning } = scoreFromQuiz({
    quiz,
    distanceKm: km,
    contactPhone,
    notesIntentPoints,
    notesIntentReasoning,
  });
  return {
    result: { score, category, reasoning },
    promptVersion: llmRan ? "rules-v3-llm-notes" : "rules-v2",
  };
}

/**
 * Load the clinic's primary location and ensure it has coordinates. If the
 * row has no lat/lng yet, geocode its address (or name as fallback) and
 * persist back so subsequent leads skip the Nominatim hit.
 */
async function getPrimaryLocationCoords(clinicId: string): Promise<LatLng | null> {
  const [loc] = await db
    .select({
      id: schema.locations.id,
      address: schema.locations.address,
      name: schema.locations.name,
      lat: schema.locations.lat,
      lng: schema.locations.lng,
    })
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.clinicId, clinicId),
        isNull(schema.locations.archivedAt)
      )
    )
    .orderBy(
      // is_primary=true first, then by display_order ascending.
      sql`${schema.locations.isPrimary} desc`,
      asc(schema.locations.displayOrder)
    )
    .limit(1);

  if (!loc) return null;

  if (loc.lat !== null && loc.lng !== null) {
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
  }

  const query = (loc.address?.trim() || loc.name?.trim()) ?? "";
  if (!query) return null;
  const resolved = await geocode(query);
  if (!resolved) return null;

  // Cache on the location row so the next lead doesn't re-query.
  await db
    .update(schema.locations)
    .set({
      lat: resolved.lat.toFixed(6),
      lng: resolved.lng.toFixed(6),
    })
    .where(eq(schema.locations.id, loc.id));

  return resolved;
}

// ---------------------------------------------------------------
// Heuristic scorer (manual / WhatsApp / paid-ad intake without structured quiz)
// ---------------------------------------------------------------

function scoreWithHeuristic(
  req: typeof schema.requests.$inferSelect
): ScoreResult {
  let score = 40;
  const reasons: string[] = [];

  const wish = (req.treatmentWish ?? "").toLowerCase();
  const msg = (req.message ?? "").toLowerCase();
  const combined = `${wish} ${msg}`;

  // Treatment-value bonus aligned with the rule-based scorer's tier table.
  // Shared in treatment-tiers.ts so the two paths can't drift apart.
  const inferredCategory = inferCategoryFromText(combined);
  if (inferredCategory) {
    const tierPts = tierBasePoints(inferredCategory);
    score += tierPts;
    reasons.push(`Tier ${inferredCategory} (+${tierPts})`);
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
// Notes-intent LLM scorer (called by scoreWithRules for the notes bucket).
// Reads just the free-text notes field and returns 0..10 points + a short
// German reasoning string. Keeps the surface small: never sees other quiz
// answers, never makes a final qualified/disqualified judgement — the
// rule-based path owns those decisions.
// ---------------------------------------------------------------
async function scoreNotesWithOpenAI(
  notes: string
): Promise<{ points: number; reasoning: string }> {
  const systemPrompt = [
    "Du bewertest die Freitext-Notizen aus einem Vorqualifizierungs-Formular für Ästhetik-Praxen in DACH.",
    "Lies nur die Notizen und schätze die Kaufabsicht der Patient:in ein.",
    "Antworte NUR mit JSON im Format:",
    `{"points": number 0..15, "reasoning": "kurze deutsche Begründung, max. 80 Zeichen"}`,
    "Skala:",
    "  0-1  = leer, ein Wort, Platzhalter, Gibberish, Off-Topic.",
    "  2-5  = generische Neugier (\"möchte mehr erfahren\", nur Preisfragen).",
    "  6-10 = konkrete Beschwerde, spezifische Sorge, genannte Behandlung, oder klares Terminsignal.",
    "  11-15 = mehrere High-Intent-Signale (z. B. konkrete Behandlung + Zeitrahmen + Budget + Ausgangslage).",
    "Beurteile NIE medizinische Eignung. Beurteile NIE Person oder Bonität. Nur Kaufabsicht aus dem Text.",
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
        { role: "user", content: notes },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`openai notes http ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai notes empty response");

  const parsed = JSON.parse(content) as { points?: unknown; reasoning?: unknown };
  const points = Math.max(0, Math.min(15, Math.round(Number(parsed.points ?? 0))));
  const reasoning = String(parsed.reasoning ?? "").trim().slice(0, 120) || "(keine Begründung)";
  return { points, reasoning };
}

// ---------------------------------------------------------------
// OpenAI scorer (full-lead path; used only when no quiz data is present)
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
    "Du bewertest Patientenanfragen für Praxen für Ästhetische Medizin und Zahnmedizin in DACH.",
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
