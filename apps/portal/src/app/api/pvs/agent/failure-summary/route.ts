import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { db, schema } from "@/db/client";

/**
 * PVS Bridge: dead-letter prune roll-up ingest (P2-2).
 *
 * Producer: apps/bridge/agent POSTs this once per day from the vacuum
 * tick — BEFORE it deletes the local failed rows from its SQLite outbox.
 * The portal records the roll-up so an operator can answer "what did we
 * lose, when, and why" months after the local outbox has pruned the
 * underlying rows.
 *
 * Append-only by design: this is an audit-trail surface. No upsert.
 * Rate-limit is loose per-clinic (5/min) because the producer cadence
 * is daily; bursts would happen on a fresh agent rolling over a big
 * backlog during the first prune.
 */

const FailureSummarySchema = z.object({
  clinicId: z.string().uuid(),
  prunedCount: z.number().int().nonnegative().max(10_000_000),
  prunedOldestAt: z.number().int().positive().nullable(),
  prunedNewestAt: z.number().int().positive().nullable(),
  reasons: z
    .array(
      z.object({
        reason: z.string().max(500),
        count: z.number().int().nonnegative().max(10_000_000),
      })
    )
    .max(20),
  sentAt: z.number().int().positive(),
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

  if (requestMeta.ip) {
    const ipRl = await rateLimit("pvs-agent-fs-ip", requestMeta.ip, {
      limit: 60,
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return genericFail();
  }

  const parseResult = FailureSummarySchema.safeParse(parsed);
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

  const rl = await rateLimit("pvs-agent-fs", event.clinicId, {
    limit: 5,
    windowSeconds: 60,
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

  const sigOk = await verifyClinicSignature(event.clinicId, raw, sig, "pvs");
  if (!sigOk) {
    after(() =>
      writeAudit({
        clinicId: event.clinicId,
        action: "pvs_agent_failure_summary_reject",
        entityKind: "pvs_agent_failure_summary",
        diff: { reason: "bad_signature" },
        requestMeta,
      })
    );
    return genericFail();
  }

  try {
    const [inserted] = await db
      .insert(schema.pvsAgentFailureSummary)
      .values({
        clinicId: event.clinicId,
        prunedCount: event.prunedCount,
        prunedOldestAt: event.prunedOldestAt
          ? new Date(event.prunedOldestAt)
          : null,
        prunedNewestAt: event.prunedNewestAt
          ? new Date(event.prunedNewestAt)
          : null,
        reasons: event.reasons as unknown as Record<string, unknown>,
        reportedAt: new Date(event.sentAt),
      })
      .returning({ id: schema.pvsAgentFailureSummary.id });

    after(() =>
      writeAudit({
        clinicId: event.clinicId,
        action: "pvs_agent_failure_summary",
        entityKind: "pvs_agent_failure_summary",
        entityId: inserted?.id,
        diff: {
          prunedCount: event.prunedCount,
          topReason: event.reasons[0]?.reason ?? null,
        },
        requestMeta,
      })
    );

    return NextResponse.json(
      { ok: true, id: inserted?.id ?? null },
      { status: 201 }
    );
  } catch (err) {
    console.error("[pvs-agent-failure-summary] handler failed:", err);
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
