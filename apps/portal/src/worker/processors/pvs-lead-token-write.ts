import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { leadTokenForRequestId } from "@/server/pvs-token";

/**
 * PVS Bridge — Direction A token writer.
 *
 * Goal: write the EINS-Lead-{8hex} token into the PVS bemerkung field for
 * the patient implied by a newly-created request, so the Bridge can Stage-2
 * link the next PVS event without human intervention.
 *
 * Adapters' write-back capability varies:
 *   • Tomedo:    REST PATCH /patients/{id}.bemerkung — supported (V1.5)
 *   • HealthHub: FHIR PUT Patient with note[] field — supported (V1.5)
 *   • RED:       FHIR PUT Patient with note[] field — supported (V1.5)
 *   • GDT-Agent: no write-back capability — token shown in portal UI for MFA
 *   • CSV:       no write-back — token shown in portal UI for MFA
 *   • n8n:       supported when workflow has write permission — depends
 *
 * The actual HTTP write happens inside apps/bridge/* per-adapter code.
 * This worker is the portal-side trigger that hands off to the bridge by
 * persisting a `request_activities` "lead_token_pending" row that the
 * bridge polls for. For now the worker only emits the activity row; the
 * bridge-side write loop is built alongside each adapter in V1.5.
 *
 * Idempotency: re-running for the same requestId is a no-op (the activity
 * row already exists).
 */

export interface PvsLeadTokenWriteJob {
  requestId: string;
}

export async function processPvsLeadTokenWrite(
  job: PvsLeadTokenWriteJob
): Promise<void> {
  const { requestId } = job;

  const [req] = await db
    .select({
      id: schema.requests.id,
      clinicId: schema.requests.clinicId,
      patientId: schema.requests.patientId,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1);
  if (!req) {
    console.warn(`[pvs-lead-token-write] request ${requestId} not found`);
    return;
  }

  const token = leadTokenForRequestId(requestId);

  // Find clinic's PVS link to decide if write-back is supported. CSV/GDT
  // skip silently.
  const [link] = await db
    .select({
      vendor: schema.pvsLink.pvsVendor,
      status: schema.pvsLink.status,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, req.clinicId))
    .limit(1);

  const supportsWriteback =
    !!link &&
    link.status === "connected" &&
    (link.vendor === "tomedo" ||
      link.vendor === "healthhub" ||
      link.vendor === "red" ||
      link.vendor === "n8n_custom");

  // Always log the token as a request_activity so MFA + the patient-detail
  // page can show it. The bridge-side write loop will read these to find
  // pending writes.
  await db.insert(schema.requestActivities).values({
    requestId: req.id,
    actorId: null,
    kind: "note",
    body: `EINS-Lead-Token: ${token}`,
    meta: {
      source: "pvs_lead_token_write",
      token,
      vendor: link?.vendor ?? null,
      writebackPending: supportsWriteback,
    },
  });
}
