import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminForApi } from "@/auth/admin-guards";
import {
  describeWorkerEffect,
  getEventDetail,
} from "@/server/queries/admin-pvs-events";

/**
 * Admin-only event detail. Returns the full pvs_event_log row plus the
 * "Worker-Effekt" placeholder (today: always unlinked, see the helper
 * in admin-pvs-events.ts for why). The signature header is intentionally
 * not surfaced — it is recomputed at replay time from the per-clinic
 * 'pvs' secret and not persisted at ingest.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminForApi();
  if (!gate.ok) return gate.response;

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

  return NextResponse.json({
    id: detail.id,
    clinicId: detail.clinicId,
    clinicDisplayName: detail.clinicDisplayName,
    bridgeSource: detail.bridgeSource,
    kind: detail.kind,
    pvsExternalEventId: detail.pvsExternalEventId,
    occurredAt: detail.occurredAt.toISOString(),
    receivedAt: detail.receivedAt.toISOString(),
    ingestedAt: detail.ingestedAt.toISOString(),
    payload: detail.payload,
    workerEffect: describeWorkerEffect(detail),
  });
}
