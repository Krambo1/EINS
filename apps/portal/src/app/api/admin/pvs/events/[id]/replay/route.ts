import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminForApi } from "@/auth/admin-guards";
import { applyPvsEvent, PvsEventSchema } from "@/server/pvs-events";
import { writeAudit } from "@/server/audit";
import { getEventDetail } from "@/server/queries/admin-pvs-events";

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
 * Note: vendor_mismatch surfaces when the clinic's pvs_link.vendor has
 * changed since the original event was ingested. We surface the bridge
 * error directly so the operator can decide.
 */
export async function POST(
  _request: NextRequest,
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
      result,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.reason } },
      { status: 409 }
    );
  }

  return NextResponse.json({
    status: result.status,
    newEventLogId: result.status === "ingested" ? result.eventLogId : null,
    replayedExternalEventId: replayedExternalId,
  });
}
