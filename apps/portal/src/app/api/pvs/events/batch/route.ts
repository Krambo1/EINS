import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import {
  applyPvsEvent,
  PvsEventSchema,
  type PvsEventResult,
} from "@/server/pvs-events";

/**
 * PVS Bridge — batch ingest endpoint for initial-sync throughput.
 *
 * Used during the first hours after a clinic connects a new PVS adapter, to
 * pull back 12 months of historical events without saturating the per-event
 * endpoint or hitting its rate limit. Up to BATCH_MAX events per request;
 * each is processed sequentially (we don't parallelise inside one request
 * because applyPvsEvent's idempotency relies on the UNIQUE index and
 * Postgres-side serializability per row).
 *
 * Rate limit is intentionally higher than /api/pvs/events because the
 * batch endpoint amortises HMAC verification: one signature check covers
 * up to BATCH_MAX events. Per-event burst rate is still ~25/sec which is
 * comfortably ahead of any single-clinic initial-sync need.
 */

const BATCH_MAX = 500;

const BatchBody = z.object({
  clinicId: z.string().uuid(),
  events: z.array(PvsEventSchema).min(1).max(BATCH_MAX),
});

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sig = request.headers.get("x-eins-signature");

  // P1-4: IP rate-limit FIRST, before JSON parse or DB hit. See the
  // long-form rationale in /api/pvs/events/route.ts. Batch limit is
  // tighter per-IP because a single batch carries up to 500 events, so
  // the budget is "30 batches/minute = 15,000 events/minute" — more
  // than any legitimate adapter needs and well above the per-clinic gate.
  const ipRaw =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const ip = ipRaw.split(",")[0]?.trim() || null;
  if (ip) {
    const ipRl = await rateLimit("pvs-events-batch-ip", ip, {
      limit: 30,
      windowSeconds: 60,
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

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }

  const parseResult = BatchBody.safeParse(parsedJson);
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
  const { clinicId, events } = parseResult.data;

  // Cross-check: every event in the batch must carry the same clinicId.
  for (const event of events) {
    if (event.clinicId !== clinicId) {
      return NextResponse.json(
        { error: { code: "clinic_mismatch" } },
        { status: 400 }
      );
    }
  }

  // Per-clinic rate limit (existing). IP-level gate above runs first.
  const rl = await rateLimit("pvs-events-batch", clinicId, {
    limit: 60,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.resetInSeconds),
          "X-PVS-RateLimit-Reason": "clinic",
        },
      }
    );
  }

  const ok = await verifyClinicSignature(clinicId, raw, sig, "pvs");
  if (!ok) {
    await writeAudit({
      clinicId,
      action: "pvs_event_batch_reject",
      entityKind: "pvs_event_log",
      diff: { reason: "bad_signature", batchSize: events.length },
    });
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }

  // Sequential apply. Each event hits the same UNIQUE-on-conflict path as
  // the single-event endpoint, so replays in the batch are deduplicated
  // server-side and don't cause errors.
  let ingestedCount = 0;
  let dedupedCount = 0;
  let quarantinedCount = 0;
  let errorCount = 0;
  const errors: Array<{ idx: number; reason: string }> = [];

  for (let i = 0; i < events.length; i++) {
    let result: PvsEventResult;
    try {
      result = await applyPvsEvent(events[i]!);
    } catch (err) {
      console.error(`[pvs-events-batch] idx=${i} threw:`, err);
      errorCount += 1;
      errors.push({ idx: i, reason: "internal_error" });
      continue;
    }
    if (!result.ok) {
      errorCount += 1;
      errors.push({ idx: i, reason: result.reason });
      continue;
    }
    if (result.status === "deduped") {
      dedupedCount += 1;
    } else if (result.status === "quarantined") {
      quarantinedCount += 1;
    } else {
      ingestedCount += 1;
    }
  }

  await writeAudit({
    clinicId,
    action: "pvs_event_batch",
    entityKind: "pvs_event_log",
    diff: {
      batchSize: events.length,
      ingestedCount,
      dedupedCount,
      quarantinedCount,
      errorCount,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      ingested: ingestedCount,
      deduped: dedupedCount,
      quarantined: quarantinedCount,
      errors: errors.slice(0, 50),
    },
    { status: 201 }
  );
}
