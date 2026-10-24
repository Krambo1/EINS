import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { resolveBundles } from "@/server/pvs-vendor-config";

/**
 * PVS Bridge: signed vendor-config delivery (0071).
 *
 * The agent learns from its heartbeat response that a config differs, then
 * calls this endpoint for the full bundles. Two steps rather than one so the
 * once-a-minute heartbeat stays small and the multi-kilobyte YAML only moves
 * when something actually changed.
 *
 * The HMAC here proves the request came from an enrolled agent. It is NOT what
 * makes the config trustworthy: each bundle carries an Ed25519 signature made
 * with a key this application does not hold, and the agent verifies that
 * separately before running a single statement. A full compromise of the portal
 * can therefore withhold configs or replay old ones, but cannot author one.
 *
 * Security mirrors /api/pvs/agent/heartbeat:
 *   1. Per-IP rate limit (cheap rejection).
 *   2. Envelope parse + Zod.
 *   3. Per-clinic rate limit.
 *   4. HMAC-SHA256 over the raw body against the per-clinic 'pvs' secret.
 *   5. Symmetric "invalid_request" failure so probes cannot enumerate clinics.
 */

const RequestSchema = z.object({
  clinicId: z.string().uuid(),
  /**
   * Vendor ids the agent wants. Bounded because it is a request-for-work list,
   * not telemetry: the whole vendor set is under ten entries, and a longer list
   * is either a bug or an attempt to make one request do a lot of work.
   */
  vendors: z.array(z.string().max(64)).max(20),
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
    const ipRl = await rateLimit("pvs-agent-cfg-ip", requestMeta.ip, {
      limit: 120,
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

  const result = RequestSchema.safeParse(parsed);
  if (!result.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_envelope",
          issues: result.error.issues.slice(0, 5),
        },
      },
      { status: 400 }
    );
  }
  const body = result.data;

  // A well-behaved agent hits this only when a config changed, so anything
  // above a handful per minute is either a retry storm or abuse. Tighter than
  // the heartbeat's budget on purpose: this endpoint reads and returns more.
  const rl = await rateLimit("pvs-agent-cfg", body.clinicId, {
    limit: 10,
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

  const sigOk = await verifyClinicSignature(body.clinicId, raw, sig, "pvs");
  if (!sigOk) {
    after(() =>
      writeAudit({
        clinicId: body.clinicId,
        action: "pvs_agent_config_reject",
        entityKind: "pvs_vendor_config",
        diff: { reason: "bad_signature" },
        requestMeta,
      })
    );
    return genericFail();
  }

  try {
    // resolveBundles re-runs the clinic's own rollout resolution, so asking for
    // a vendor this Praxis was never targeted with returns nothing rather than
    // handing out a config that is still in pilot elsewhere.
    const configs = await resolveBundles(body.clinicId, body.vendors);

    if (configs.length > 0) {
      after(() =>
        writeAudit({
          clinicId: body.clinicId,
          action: "pvs_agent_config_deliver",
          entityKind: "pvs_vendor_config",
          diff: { requested: body.vendors, delivered: configs.length },
          requestMeta,
        })
      );
    }

    return NextResponse.json({ configs }, { status: 200 });
  } catch (err) {
    console.error("[pvs-agent-config] handler failed:", err);
    return NextResponse.json({ error: { code: "internal" } }, { status: 500 });
  }
}

function genericFail(): NextResponse {
  return NextResponse.json(
    { error: { code: "invalid_request" } },
    { status: 400 }
  );
}
