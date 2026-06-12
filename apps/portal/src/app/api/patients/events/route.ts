import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { applyPatientEvent } from "@/server/patient-events";

/**
 * EINS Bewertungen — Make.com → portal patient-event endpoint.
 *
 * Make.com runs one scenario per Praxis. The scenario translates each PMS's
 * "appointment completed" / "patient consent" / "unsubscribe" webhook into
 * the canonical envelope below and POSTs here, signed with the per-clinic
 * HMAC secret (the same one used by /api/leads/intake — `platform='intake'`
 * in `platform_credentials`).
 *
 * Security mirrors /api/leads/intake exactly:
 *   1. HMAC-SHA256 over the raw body (X-EINS-Signature).
 *   2. Per-clinic rate limit (240 req / 10 min — higher than leads since a
 *      busy Praxis may push tens of completed appointments per day).
 *   3. Honeypot field "hp_field" — if present, silently 202.
 *   4. Symmetric error response so probes can't enumerate clinics.
 *
 * Consent model (HWG-compliant, see apps/portal/docs/eins-bewertungen.md):
 *   - `reviewConsent: true` MUST come from the Make scenario after the
 *     Praxis attests in writing during onboarding that they inform every
 *     patient at intake about the post-visit review email. We trust the
 *     attestation, but log it for audit.
 */

const PatientSchema = z.object({
  email: z.string().email().max(200),
  fullName: z.string().max(200).optional(),
  phone: z.string().max(64).optional(),
  externalId: z.string().max(200).optional(),
});

const Body = z.object({
  clinicId: z.string().uuid(),
  eventKind: z.enum([
    "appointment_completed",
    "patient_consent_given",
    "patient_unsubscribed",
  ]),
  patient: PatientSchema,
  appointmentCompletedAt: z.string().datetime().optional(),
  locationId: z.string().uuid().optional(),
  treatmentLabel: z.string().max(200).optional(),
  reviewConsent: z.boolean(),
  hp_field: z.string().optional(),
});

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

  // Per-IP-first gate (pentest M6): a known clinicId (these are in every
  // webhook URL) must not be sprayable to exhaust a clinic's bucket with
  // unsigned junk. Runs before JSON-parse + the per-clinic limit, like
  // /api/pvs/events.
  if (requestMeta.ip) {
    const ipRl = await rateLimit("patients-events-ip", requestMeta.ip, {
      limit: 2400,
      windowSeconds: 600,
    });
    if (!ipRl.ok) {
      return NextResponse.json(
        { error: { code: "rate_limited" } },
        {
          status: 429,
          headers: {
            "Retry-After": String(ipRl.resetInSeconds),
            "X-PVS-RateLimit-Reason": "ip",
          },
        }
      );
    }
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    return genericFail();
  }

  // Honeypot tripped → pretend success, log nothing interesting.
  if (parsed.hp_field && parsed.hp_field.length > 0) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // Rate-limit by clinic.
  const rl = await rateLimit("patients-events", parsed.clinicId, {
    limit: 240,
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

  const ok = await verifyClinicSignature(
    parsed.clinicId,
    raw,
    sig,
    "patients"
  );
  if (!ok) {
    after(() =>
      writeAudit({
        clinicId: parsed.clinicId,
        action: "patient_event_reject",
        entityKind: "request_recall",
        diff: { reason: "bad_signature", eventKind: parsed.eventKind },
        requestMeta,
      })
    );
    return genericFail();
  }

  try {
    const result = await applyPatientEvent({
      clinicId: parsed.clinicId,
      eventKind: parsed.eventKind,
      patient: {
        email: parsed.patient.email,
        fullName: parsed.patient.fullName ?? null,
        phone: parsed.patient.phone ?? null,
        externalId: parsed.patient.externalId ?? null,
      },
      appointmentCompletedAt: parsed.appointmentCompletedAt
        ? new Date(parsed.appointmentCompletedAt)
        : null,
      locationId: parsed.locationId ?? null,
      treatmentLabel: parsed.treatmentLabel ?? null,
      reviewConsent: parsed.reviewConsent,
    });

    if (!result.ok) {
      after(() =>
        writeAudit({
          clinicId: parsed.clinicId,
          action: "patient_event_reject",
          entityKind: "request_recall",
          diff: { reason: result.reason, eventKind: parsed.eventKind },
          requestMeta,
        })
      );
      const status =
        result.reason === "clinic_not_found"
          ? 404
          : result.reason === "consent_missing"
          ? 400
          : 400;
      return NextResponse.json(
        { error: { code: result.reason } },
        { status }
      );
    }

    after(() =>
      writeAudit({
        clinicId: parsed.clinicId,
        action: "patient_event",
        entityKind: "review_request",
        entityId:
          "reviewRequestId" in result ? result.reviewRequestId : undefined,
        diff: { eventKind: parsed.eventKind, status: result.status },
        requestMeta,
      })
    );

    return NextResponse.json({ ok: true, status: result.status }, { status: 201 });
  } catch (err) {
    console.error("[patient-events] handler failed:", err);
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
