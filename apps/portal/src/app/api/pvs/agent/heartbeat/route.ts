import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { db, schema } from "@/db/client";

/**
 * PVS Bridge: GDT-Agent heartbeat ingest (P2-2).
 *
 * Producer: apps/bridge/agent emits a heartbeat every 60s with the
 * current dead-letter snapshot from its local SQLite outbox. The portal
 * upserts pvs_agent_status by clinicId so the admin clinic detail page
 * can render "agent healthy / N failed events / oldest failure X days
 * ago" without anyone touching the workstation.
 *
 * Security mirrors /api/pvs/events:
 *   1. Per-IP rate limit first (cheap rejection).
 *   2. JSON envelope parse + Zod schema check.
 *   3. Per-clinic rate limit (heartbeats are tight — 5/min/clinic is
 *      plenty for the 1/min producer cadence; anything higher is misbehaving).
 *   4. HMAC-SHA256 over the raw body against the per-clinic 'pvs' secret.
 *   5. Symmetric "invalid_request" failure so probes can't enumerate clinics.
 */

const HeartbeatSchema = z.object({
  clinicId: z.string().uuid(),
  agentVersion: z.string().max(50),
  failedCount: z.number().int().nonnegative().max(1_000_000),
  oldestFailedAt: z.number().int().positive().nullable(),
  lastFailureReason: z.string().max(500).nullable(),
  recentReasons: z
    .array(
      z.object({
        reason: z.string().max(500),
        count: z.number().int().nonnegative().max(1_000_000),
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

  // Per-IP gate first (P1-4 pattern).
  if (requestMeta.ip) {
    const ipRl = await rateLimit("pvs-agent-hb-ip", requestMeta.ip, {
      limit: 300,
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

  const parseResult = HeartbeatSchema.safeParse(parsed);
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

  // Per-clinic budget: the producer cadence is 1/min; 5/min gives
  // headroom for cold-start fast retries without enabling abuse.
  const rl = await rateLimit("pvs-agent-hb", event.clinicId, {
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
        action: "pvs_agent_heartbeat_reject",
        entityKind: "pvs_agent_status",
        diff: { reason: "bad_signature" },
        requestMeta,
      })
    );
    return genericFail();
  }

  try {
    const oldestFailedAt = event.oldestFailedAt
      ? new Date(event.oldestFailedAt)
      : null;

    await db
      .insert(schema.pvsAgentStatus)
      .values({
        clinicId: event.clinicId,
        agentVersion: event.agentVersion,
        lastHeartbeatAt: new Date(event.sentAt),
        failedEvents: event.failedCount,
        oldestFailedAt,
        lastFailureReason: event.lastFailureReason,
        recentReasons: event.recentReasons as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: schema.pvsAgentStatus.clinicId,
        set: {
          agentVersion: event.agentVersion,
          lastHeartbeatAt: new Date(event.sentAt),
          failedEvents: event.failedCount,
          oldestFailedAt,
          lastFailureReason: event.lastFailureReason,
          recentReasons:
            event.recentReasons as unknown as Record<string, unknown>,
        },
      });

    // P2-2: alert threshold. The dashboard renders the count itself,
    // but failedCount > 100 deserves a flagged audit row so an operator
    // grepping the audit log can find "when did this go bad" without
    // joining against a time-series of heartbeats.
    if (event.failedCount > 100) {
      after(() =>
        writeAudit({
          clinicId: event.clinicId,
          action: "pvs_agent_dead_letter_alert",
          entityKind: "pvs_agent_status",
          diff: {
            failedCount: event.failedCount,
            oldestFailedAt: event.oldestFailedAt,
            lastFailureReason: event.lastFailureReason,
          },
          requestMeta,
        })
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[pvs-agent-heartbeat] handler failed:", err);
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
