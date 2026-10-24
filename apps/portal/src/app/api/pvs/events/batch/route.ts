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

// Initial syncs of a few thousand events can take a while to apply sequentially.
export const maxDuration = 60;

// Events are validated one by one (a single bad event must not fail the
// batch), so the body schema only checks the outer shape.
const BatchBody = z.object({
  clinicId: z.string().uuid(),
  events: z.array(z.unknown()).min(1).max(BATCH_MAX),
});

// Mirror of PVS_KIND_ALIASES in ../route.ts (the single-event endpoint). Keep
// the two in sync.
const PVS_KIND_ALIASES: Record<string, string> = {
  InvoicePosted: "InvoicePaid",
  invoice_paid: "InvoicePaid",
  invoice_posted: "InvoicePaid",
  RechnungBezahlt: "InvoicePaid",
};

type ParsedEvent = z.infer<typeof PvsEventSchema>;

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
  const { clinicId, events: rawEvents } = parseResult.data;

  // Per-event validation. A bad event gets its own error entry; it never
  // fails the rest of the batch. Nothing is applied yet (signature first).
  const parsed: Array<{ event: ParsedEvent } | { error: string }> = rawEvents.map(
    (raw): { event: ParsedEvent } | { error: string } => {
      let candidate = raw;
      if (
        candidate &&
        typeof candidate === "object" &&
        typeof (candidate as { kind?: unknown }).kind === "string"
      ) {
        const aliased = PVS_KIND_ALIASES[(candidate as { kind: string }).kind];
        if (aliased) candidate = { ...(candidate as object), kind: aliased };
      }
      const r = PvsEventSchema.safeParse(candidate);
      if (!r.success) return { error: "invalid_envelope" };
      if (r.data.clinicId !== clinicId) return { error: "clinic_mismatch" };
      // csv_upload is reserved for the in-process CSV worker (see the single route).
      if (r.data.bridgeSource === "csv_upload") return { error: "invalid_bridge_source" };
      return { event: r.data };
    }
  );
  const batchSize = rawEvents.length;

  const ok = await verifyClinicSignature(clinicId, raw, sig, "pvs");
  if (!ok) {
    await writeAudit({
      clinicId,
      action: "pvs_event_batch_reject",
      entityKind: "pvs_event_log",
      diff: { reason: "bad_signature", batchSize },
    });
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }

  // Pass 2: the per-clinic budget is spent only AFTER the signature check.
  // clinicId sits in the request body in clear text, so anyone could burn a
  // Praxis's quota with unsigned junk and the real agent got 429 for the
  // rest of the window (a silently stalled upload).
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

  // Sequential apply. Each event hits the same UNIQUE-on-conflict path as
  // the single-event endpoint, so replays in the batch are deduplicated
  // server-side and don't cause errors.
  let ingestedCount = 0;
  let dedupedCount = 0;
  let quarantinedCount = 0;
  let errorCount = 0;
  const errors: Array<{ idx: number; reason: string }> = [];

  const results: Array<{ status: "ingested" | "deduped" | "quarantined" } | { error: string }> = [];

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!;
    if ("error" in p) {
      errorCount += 1;
      errors.push({ idx: i, reason: p.error });
      results.push({ error: p.error });
      continue;
    }
    let result: PvsEventResult;
    try {
      result = await applyPvsEvent(p.event);
    } catch (err) {
      console.error(`[pvs-events-batch] idx=${i} threw:`, err);
      errorCount += 1;
      errors.push({ idx: i, reason: "internal_error" });
      results.push({ error: "internal_error" });
      continue;
    }
    if (!result.ok) {
      errorCount += 1;
      errors.push({ idx: i, reason: result.reason });
      results.push({ error: result.reason });
      continue;
    }
    if (result.status === "deduped") {
      dedupedCount += 1;
      results.push({ status: "deduped" });
    } else if (result.status === "quarantined") {
      quarantinedCount += 1;
      results.push({ status: "quarantined" });
    } else {
      ingestedCount += 1;
      results.push({ status: "ingested" });
    }
  }

  await writeAudit({
    clinicId,
    action: "pvs_event_batch",
    entityKind: "pvs_event_log",
    diff: {
      batchSize,
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
      // Aligned 1:1 with the input events.
      results,
    },
    { status: 201 }
  );
}
