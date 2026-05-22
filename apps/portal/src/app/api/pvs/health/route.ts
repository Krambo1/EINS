import { NextResponse, after, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { applyPvsHealth, PvsHealthEventSchema } from "@/server/pvs-health";

/**
 * PVS Bridge: operational-health ingest endpoint.
 *
 * Producer: the on-prem agent's drift-publisher and the cloud REST adapters'
 * link-health hooks. Each signs with the per-clinic 'pvs' HMAC secret (the
 * same secret that signs canonical events; one credential, two purposes).
 *
 * Why a separate route from /api/pvs/events: health is operational
 * telemetry, not patient data. Different storage table, different
 * dedup key, different Zod schema, and a tighter rate limit (drift
 * detection should be rare; a producer that hammers this endpoint is
 * misbehaving and we want fast 429s).
 *
 * Symmetric "invalid_request" failure mode mirrors the events route so a
 * probe can't enumerate which clinics exist on the platform.
 */

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sig = request.headers.get("x-eins-signature");

  const ipRaw =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const requestMeta = {
    ip: ipRaw.split(",")[0]?.trim() || null,
    ua: request.headers.get("user-agent") ?? null,
  };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return genericFail();
  }

  // Honeypot: return 202 without doing any work.
  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    typeof (parsedJson as { hp_field?: unknown }).hp_field === "string" &&
    (parsedJson as { hp_field: string }).hp_field.length > 0
  ) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  const parseResult = PvsHealthEventSchema.safeParse(parsedJson);
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

  // csv_upload is reserved for the in-process worker; see the events route
  // for the same guard. A wire-borne csv_upload health event is suspicious.
  if (event.bridgeSource === "csv_upload") {
    after(() =>
      writeAudit({
        clinicId: event.clinicId,
        action: "pvs_health_reject",
        entityKind: "pvs_link_health",
        diff: {
          reason: "csv_upload_over_wire",
          eventKind: event.eventKind,
        },
        requestMeta,
      })
    );
    return NextResponse.json(
      { error: { code: "invalid_bridge_source" } },
      { status: 400 }
    );
  }

  // 60/min per clinic. Schema-drift detection is naturally rare (one
  // signal per real config change); auth/connection signals batch
  // through this same path. A clinic flooding > 60/min is almost
  // certainly looping on a non-recoverable error and should back off.
  const rl = await rateLimit("pvs-health", event.clinicId, {
    limit: 60,
    windowSeconds: 60,
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

  const sigOk = await verifyClinicSignature(event.clinicId, raw, sig, "pvs");
  if (!sigOk) {
    after(() =>
      writeAudit({
        clinicId: event.clinicId,
        action: "pvs_health_reject",
        entityKind: "pvs_link_health",
        diff: {
          reason: "bad_signature",
          eventKind: event.eventKind,
          bridgeSource: event.bridgeSource,
        },
        requestMeta,
      })
    );
    return genericFail();
  }

  try {
    const result = await applyPvsHealth(event);
    if (!result.ok) {
      after(() =>
        writeAudit({
          clinicId: event.clinicId,
          action: "pvs_health_reject",
          entityKind: "pvs_link_health",
          diff: { reason: result.reason, eventKind: event.eventKind },
          requestMeta,
        })
      );
      const status =
        result.reason === "clinic_not_found"
          ? 404
          : result.reason === "vendor_mismatch"
          ? 409
          : result.reason === "internal_error"
          ? 500
          : 400;
      return NextResponse.json(
        { error: { code: result.reason } },
        { status }
      );
    }

    if (result.status === "deduped") {
      return NextResponse.json(
        { ok: true, status: "deduped" },
        { status: 201 }
      );
    }

    after(() =>
      writeAudit({
        clinicId: event.clinicId,
        action: "pvs_health",
        entityKind: "pvs_link_health",
        entityId: result.id ?? undefined,
        diff: {
          eventKind: event.eventKind,
          streamKind: event.streamKind,
          bridgeSource: event.bridgeSource,
          severity: event.severity,
          resolved: result.status === "resolved",
        },
        requestMeta,
      })
    );

    return NextResponse.json(
      {
        ok: true,
        status: result.status,
        id: result.id,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[pvs-health] handler failed:", err);
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
