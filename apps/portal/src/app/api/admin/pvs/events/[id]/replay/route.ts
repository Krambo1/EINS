import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminForApi } from "@/auth/admin-guards";
import { applyPvsEvent, PvsEventSchema } from "@/server/pvs-events";
import { writeAudit } from "@/server/audit";
import { getEventDetail } from "@/server/queries/admin-pvs-events";
import { verifyPvsEventIntegrityTag } from "@/server/pvs-event-integrity";

/**
 * Replay a stored pvs_event_log row through the live ingest pipeline.
 *
 * We take the original payload (which IS the full canonical envelope —
 * pvs-events.ts:406 stores `input as Record<string, unknown>`), append
 * `:replay:<unix-ms>` to pvsExternalEventId so the UNIQUE-dedup index
 * doesn't immediately swallow it, validate against PvsEventSchema, and
 * call applyPvsEvent. The result is the new event_log id (or a deduped
 * marker if the same suffix already exists — practically impossible at
 * millisecond resolution, but the contract is honoured).
 *
 * Legacy rows (payload_sig IS NULL, ingested before migration 0060) are
 * refused: nothing proves they were not edited at rest. An operator who has
 * checked the row by hand can pass `?allowLegacy=1`.
 *
 * Note: vendor_mismatch surfaces when the clinic's pvs_link.vendor has
 * changed since the original event was ingested. We surface the bridge
 * error directly so the operator can decide.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminForApi();
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

  const { id: rawId } = await params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) {
    return NextResponse.json(
      { error: { code: "invalid_id" } },
      { status: 400 }
    );
  }

  const detail = await getEventDetail(id.data);
  if (!detail) {
    return NextResponse.json(
      { error: { code: "not_found" } },
      { status: 404 }
    );
  }

  // H3: re-verify the stored payload's server-side integrity tag before
  // re-applying it. The original wire HMAC can't be re-checked (the per-clinic
  // agent secret rotates on re-enrollment), so this server-keyed tag is the
  // only thing standing between an at-rest-tampered row and a trusted re-ingest.
  // A NULL tag means the row predates migration 0060 (legacy) — we allow the
  // replay but flag it so the operator knows it wasn't integrity-checked.
  const integrityChecked = detail.payloadSig !== null;
  if (detail.payloadSig === null) {
    const allowLegacy =
      new URL(request.url).searchParams.get("allowLegacy") === "1";
    if (!allowLegacy) {
      await writeAudit({
        clinicId: detail.clinicId,
        actorEmail: admin.email,
        action: "replay_rejected",
        entityKind: "pvs_event_log",
        entityId: detail.id,
        diff: { reason: "legacy_unsigned" },
      });
      return NextResponse.json(
        { error: { code: "legacy_unsigned" } },
        { status: 409 }
      );
    }
  }
  if (
    detail.payloadSig !== null &&
    !verifyPvsEventIntegrityTag(detail.payload, detail.payloadSig)
  ) {
    await writeAudit({
      clinicId: detail.clinicId,
      actorEmail: admin.email,
      action: "replay_rejected",
      entityKind: "pvs_event_log",
      entityId: detail.id,
      diff: { reason: "integrity_failed" },
    });
    return NextResponse.json(
      { error: { code: "integrity_failed" } },
      { status: 409 }
    );
  }

  // The payload is the whole canonical envelope, including clinicId. A row
  // whose payload names another clinic than its own column was edited or
  // mis-filed: replaying it would write into the wrong tenant.
  if (detail.payload.clinicId !== detail.clinicId) {
    await writeAudit({
      clinicId: detail.clinicId,
      actorEmail: admin.email,
      action: "replay_rejected",
      entityKind: "pvs_event_log",
      entityId: detail.id,
      diff: { reason: "clinic_mismatch" },
    });
    return NextResponse.json(
      { error: { code: "clinic_mismatch" } },
      { status: 409 }
    );
  }

  const replaySuffix = `:replay:${Date.now()}`;
  const replayedExternalId = `${detail.pvsExternalEventId}${replaySuffix}`;

  const candidate = {
    ...detail.payload,
    pvsExternalEventId: replayedExternalId,
  };

  const parsed = PvsEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "payload_invalid",
          issues: parsed.error.issues,
        },
      },
      { status: 422 }
    );
  }

  const result = await applyPvsEvent(parsed.data);

  await writeAudit({
    clinicId: detail.clinicId,
    actorEmail: admin.email,
    action: "replay",
    entityKind: "pvs_event_log",
    entityId: detail.id,
    diff: {
      replayedExternalEventId: replayedExternalId,
      integrityChecked,
      result,
    },
  });

  if (!result.ok) {
    // internal_error is a server-side failure, not a state conflict.
    // billing_conflict matches the ingest routes (422: never retryable).
    const status =
      result.reason === "internal_error"
        ? 500
        : result.reason === "billing_conflict"
          ? 422
          : 409;
    return NextResponse.json({ error: { code: result.reason } }, { status });
  }

  return NextResponse.json({
    status: result.status,
    newEventLogId: result.status === "ingested" ? result.eventLogId : null,
    replayedExternalEventId: replayedExternalId,
  });
}
