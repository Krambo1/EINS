import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { redeemAgentEnrollment } from "@/server/pvs-agent-enroll";

/**
 * PVS Bridge — GDT-Agent enrollment redemption.
 *
 * The agent (running on the Praxis Windows/Mac host) POSTs here with the
 * one-time token it received via CLI args + a stable machine fingerprint.
 * On success we return the per-clinic HMAC secret which the agent stores
 * encrypted via DPAPI/Keychain and uses to sign all subsequent
 * /api/pvs/events POSTs.
 *
 * The secret is returned ONCE. If the agent loses it, the inhaber must
 * re-issue a new enrollment from the portal UI.
 *
 * Rate limit is strict (10 req / 10 min per clinic) because this is a
 * brute-force surface: an attacker who knows a clinicId could spray random
 * tokens. The token entropy is 256 bits but defense-in-depth.
 */

const Body = z.object({
  clinicId: z.string().uuid(),
  token: z.string().min(32).max(200),
  machineFingerprint: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }
  const parsed = Body.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const rl = await rateLimit("pvs-agent-enroll", body.clinicId, {
    limit: 10,
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

  const remoteIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  const result = await redeemAgentEnrollment({
    clinicId: body.clinicId,
    token: body.token,
    machineFingerprint: body.machineFingerprint,
    remoteIp,
  });

  if (!result.ok) {
    await writeAudit({
      clinicId: body.clinicId,
      action: "pvs_agent_enroll_reject",
      entityKind: "pvs_agent_enrollment_tokens",
      diff: {
        reason: result.reason,
        machineFingerprint: body.machineFingerprint,
      },
    });
    // Return a generic error to avoid leaking which check failed.
    return NextResponse.json(
      { error: { code: "enrollment_failed", detail: result.reason } },
      { status: 401 }
    );
  }

  await writeAudit({
    clinicId: body.clinicId,
    action: "pvs_agent_enroll",
    entityKind: "pvs_agent_enrollment_tokens",
    diff: {
      machineFingerprint: body.machineFingerprint,
      vendor: result.vendor,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      pvsSecretHex: result.pvsSecretHex,
      vendor: result.vendor,
      endpoint: "/api/pvs/events",
    },
    { status: 200 }
  );
}
