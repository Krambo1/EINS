import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { applyPvsEvent, PvsEventSchema } from "@/server/pvs-events";

/**
 * PVS Bridge — canonical event ingest endpoint.
 *
 * Producers:
 *   • apps/bridge/* native adapters (Tomedo polling, HealthHub + RED FHIR
 *     webhooks). Each signs with the per-clinic 'pvs' HMAC secret.
 *   • apps/bridge/agent (GDT-Agent) for on-prem PVSs — signs directly with
 *     the same secret minted at enrollment time.
 *   • Self-hosted n8n workflows for long-tail PVSs — signs directly.
 *
 * The CSV-upload path does NOT come through this endpoint; the worker
 * calls applyPvsEvent in-process for higher throughput.
 *
 * Security mirrors /api/patients/events:
 *   1. HMAC-SHA256 over the raw body (X-EINS-Signature).
 *   2. Per-clinic rate limit (600 req / 10 min — higher than patients-events
 *      because initial-sync bursts are common; batch endpoint is preferred
 *      for >200 events).
 *   3. Honeypot field 'hp_field'.
 *   4. Symmetric "invalid_request" error so probes can't enumerate clinics.
 *
 * Idempotency: dedup happens inside applyPvsEvent against the
 * (clinic_id, bridge_source, pvs_external_event_id, occurred_at) UNIQUE
 * constraint. Replays return 201 with {status: "deduped"}.
 */

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sig = request.headers.get("x-eins-signature");

  // Parse JSON before extracting clinicId for rate-limit + signature checks.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return genericFail();
  }

  // Honeypot trip — return 202 without doing any work.
  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    typeof (parsedJson as { hp_field?: unknown }).hp_field === "string" &&
    (parsedJson as { hp_field: string }).hp_field.length > 0
  ) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // Validate the canonical event envelope before going further.
  const parseResult = PvsEventSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_envelope",
          issues: parseResult.error.issues.slice(0, 5),
        },
      },
      { status: 400 }
    );
  }
  const event = parseResult.data;

  // Rate-limit by clinic before signature check.
  const rl = await rateLimit("pvs-events", event.clinicId, {
    limit: 600,
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

  // Signature check against the 'pvs' platform secret.
  const ok = await verifyClinicSignature(event.clinicId, raw, sig, "pvs");
  if (!ok) {
    await writeAudit({
      clinicId: event.clinicId,
      action: "pvs_event_reject",
      entityKind: "pvs_event_log",
      diff: {
        reason: "bad_signature",
        kind: event.kind,
        bridgeSource: event.bridgeSource,
      },
    });
    return genericFail();
  }

  try {
    const result = await applyPvsEvent(event);
    if (!result.ok) {
      await writeAudit({
        clinicId: event.clinicId,
        action: "pvs_event_reject",
        entityKind: "pvs_event_log",
        diff: { reason: result.reason, kind: event.kind },
      });
      const status =
        result.reason === "clinic_not_found"
          ? 404
          : result.reason === "link_not_ready"
          ? 409
          : 400;
      return NextResponse.json(
        { error: { code: result.reason } },
        { status }
      );
    }

    if (result.status === "deduped") {
      // Don't audit deduped writes — they're noise in the log.
      return NextResponse.json(
        { ok: true, status: "deduped" },
        { status: 201 }
      );
    }

    await writeAudit({
      clinicId: event.clinicId,
      action: "pvs_event",
      entityKind: "pvs_event_log",
      entityId: result.eventLogId,
      diff: {
        kind: event.kind,
        bridgeSource: event.bridgeSource,
        linked: result.linked ? result.linked.method : "unlinked",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: result.status,
        eventLogId: result.eventLogId,
        linked: result.linked,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[pvs-events] handler failed:", err);
    return NextResponse.json(
      { error: { code: "internal" } },
      { status: 500 }
    );
  }
}

function genericFail(): NextResponse {
  return NextResponse.json(
    { error: { code: "invalid_request" } },
    { status: 400 }
  );
}
