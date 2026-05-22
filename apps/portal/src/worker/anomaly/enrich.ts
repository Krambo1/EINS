import { env, hasOpenAI } from "@/lib/env";
import type { AlertCandidate } from "./types";

/**
 * Conditional LLM enrichment for anomaly alerts.
 *
 * Contract: this is "Sauce", not the main course. The rule library does
 * the detection AND provides default action steps. We only ask the LLM
 * for tailored additions when:
 *   - `candidate.aiEnrich === true` (caller-gated; today only "extreme"
 *     severity or multi-signal coincidences set this flag), AND
 *   - OPENAI_API_KEY is configured.
 *
 * The model is told explicitly that it MUST NOT repeat the rule's
 * default steps and MUST return an empty list when it has no genuinely
 * additive insight. The "low temperature + JSON-only + 80-char step
 * cap" combo keeps the output usable on a dashboard card.
 *
 * Failure modes: missing key, HTTP error, malformed JSON, or empty model
 * output all return `[]` silently. The widget falls back to rule-only
 * action steps, which is by design.
 */

export async function enrichWithAi(
  candidate: AlertCandidate,
  contextNote: string | null = null
): Promise<string[]> {
  if (!candidate.aiEnrich) return [];
  if (!hasOpenAI()) return [];

  const systemPrompt = [
    "Du bist eine Marketing- und Praxis-Analystin für deutsche Praxen für Ästhetische Medizin.",
    "Eingabe: eine bereits regelbasiert erkannte Auffälligkeit aus dem Praxis-Dashboard, mit Default-Maßnahmen.",
    "Aufgabe: 0 bis 2 zusätzliche, KONKRETE Maßnahmen-Schritte vorschlagen, die über die Default-Maßnahmen hinausgehen.",
    "REGELN, strikt befolgen:",
    "  - NIE einen Default-Schritt umformulieren oder wiederholen.",
    "  - Nur Schritte, die ein Praxisinhaber heute oder diese Woche selbst tun kann.",
    "  - Keine Marketing-Phrasen, keine allgemeinen Tipps („Performance prüfen“).",
    "  - Maximal 90 Zeichen pro Schritt. Imperativ. Auf Deutsch.",
    "  - Wenn keine wirklich zusätzliche, konkrete Maßnahme einfällt: leeres Array zurück.",
    "Antwort: NUR JSON `{\"steps\": string[]}`. Kein weiterer Text.",
  ].join("\n");

  const userPayload = {
    kind: candidate.kind,
    severity: candidate.severity,
    title: candidate.title,
    body: candidate.body,
    metric: candidate.metric ?? null,
    baselineValue: candidate.baselineValue ?? null,
    observedValue: candidate.observedValue ?? null,
    defaultActionSteps: candidate.defaultActionSteps,
    extraContext: contextNote,
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    });
  } catch (err) {
    console.error("[anomaly-enrich] fetch failed:", err);
    return [];
  }

  if (!res.ok) {
    console.error(`[anomaly-enrich] openai http ${res.status}`);
    return [];
  }

  let parsed: { steps?: unknown };
  try {
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[anomaly-enrich] parse failed:", err);
    return [];
  }

  if (!Array.isArray(parsed.steps)) return [];

  const defaults = new Set(
    candidate.defaultActionSteps.map((s) => s.trim().toLowerCase())
  );

  return parsed.steps
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 120)
    .filter((s) => !defaults.has(s.toLowerCase()))
    .slice(0, 2);
}
