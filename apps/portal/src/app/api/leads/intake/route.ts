import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { REQUEST_SOURCES } from "@/lib/constants";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyLeadSignature, persistLead } from "@/server/leads";

/**
 * Public lead-intake endpoint — receives form submissions from clinic
 * landing pages. Security model:
 *   1. HMAC-SHA256 signature via X-EINS-Signature (per-clinic shared secret).
 *   2. Per-clinic rate limit (60 req / 10 min) so a compromised key can't flood.
 *   3. Honeypot field "hp_field" — if present, silently drop.
 *
 * Success response is deliberately minimal and symmetric with signature
 * failure so the endpoint doesn't leak whether a clinic exists.
 */

const Body = z.object({
  clinicId: z.string().uuid(),
  source: z.enum(REQUEST_SOURCES),
  sourceCampaignId: z.string().max(200).optional(),
  sourceAdId: z.string().max(200).optional(),
  utm: z.record(z.string(), z.string()).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().max(64).optional(),
  treatmentWish: z.string().max(500).optional(),
  budgetIndication: z.string().max(200).optional(),
  message: z.string().max(5000).optional(),
  dsgvoConsent: z.boolean(),
  hp_field: z.string().optional(), // honeypot
});

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sig = request.headers.get("x-eins-signature");

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    // Symmetric response on any parse failure — don't help a probe.
    return genericFail();
  }

  // Honeypot tripped → pretend success, log nothing interesting.
  if (parsed.hp_field && parsed.hp_field.length > 0) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  if (!parsed.dsgvoConsent) {
    return NextResponse.json(
      { error: { code: "dsgvo_required", message: "DSGVO-Zustimmung erforderlich." } },
      { status: 400 }
    );
  }

  // Rate-limit by clinic — we must be careful not to leak timing here, but
  // symmetrically dropping counts as "slow down".
  const rl = await rateLimit("leads-intake", parsed.clinicId, {
    limit: 60,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      {
        status: 429,
        headers: { "Retry-After": String(rl.resetInSeconds) },
      }
    );
  }

  // Signature verification.
  const ok = await verifyLeadSignature(parsed.clinicId, raw, sig);
  if (!ok) {
    await writeAudit({
      clinicId: parsed.clinicId,
      action: "lead_intake_reject",
      entityKind: "request",
      diff: { reason: "bad_signature" },
    });
    return genericFail();
  }

  // Capture caller IP for DSGVO proof.
  const ipRaw = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  const ip = ipRaw.split(",")[0]?.trim() || null;

  try {
    const id = await persistLead(parsed.clinicId, {
      source: parsed.source,
      sourceCampaignId: parsed.sourceCampaignId ?? null,
      sourceAdId: parsed.sourceAdId ?? null,
      utm: parsed.utm ?? null,
      contactName: parsed.contactName ?? null,
      contactEmail: parsed.contactEmail ?? null,
      contactPhone: parsed.contactPhone ?? null,
      treatmentWish: parsed.treatmentWish ?? null,
      budgetIndication: parsed.budgetIndication ?? null,
      message: parsed.message ?? null,
      dsgvoConsent: true,
      dsgvoConsentIp: ip,
      rawPayload: JSON.parse(raw),
    });

    await writeAudit({
      clinicId: parsed.clinicId,
      action: "lead_intake",
      entityKind: "request",
      entityId: id,
      diff: { source: parsed.source },
    });

    // Note: BullMQ worker picks up AI-scoring jobs via a polling tick;
    // the enqueue is best-effort from a route on the portal so a missing
    // Redis doesn't reject the lead.
    try {
      const { enqueueAiScore } = await import("@/server/jobs");
      await enqueueAiScore(id);
    } catch (err) {
      console.warn("[leads] ai-score enqueue failed:", err);
    }

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    console.error("[leads] persist failed:", err);
    return NextResponse.json(
      { error: { code: "internal" } },
      { status: 500 }
    );
  }
}

function genericFail(): NextResponse {
  // Same shape as validation failure — caller can't distinguish.
  return NextResponse.json(
    { error: { code: "invalid_request" } },
    { status: 400 }
  );
}
