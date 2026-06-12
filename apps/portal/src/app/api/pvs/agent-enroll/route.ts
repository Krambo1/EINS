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

  const remoteIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  // P1-4: per-IP gate BEFORE the per-clinic gate. The clinicId is in the
  // body of every install command we hand out, so an attacker who reads
  // (or guesses) one could otherwise burn a clinic's 10/10min budget at
  // will. Per-IP is the cheap first line of defence — keyed only on the
  // requester's address, no body read required.
  if (remoteIp) {
    const ipRl = await rateLimit("pvs-agent-enroll-ip", remoteIp, {
      limit: 20,
      windowSeconds: 600,
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

  const rl = await rateLimit("pvs-agent-enroll", body.clinicId, {
    limit: 10,
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
    // P1-3: vendor_switch_requires_confirmation is a configuration error
    // the operator needs to see — there's no security benefit to opacity
    // here because the attacker would have had to present a valid token
    // for THIS clinic to even reach this check (the token itself is the
    // secret). Surface 409 with the specific reason so the agent's
    // installer can render a helpful error.
    //
    // Every OTHER failure reason stays behind the opaque 401 because
    // distinguishing "wrong token" from "expired token" from "wrong
    // fingerprint" would help a token-spray attacker iterate.
    if (result.reason === "vendor_switch_requires_confirmation") {
      return NextResponse.json(
        { error: { code: "vendor_switch_requires_confirmation" } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: { code: "enrollment_failed" } },
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

  // The response body carries the per-clinic HMAC secret in cleartext (the
  // symmetric scheme requires the agent to receive it once to sign events).
  // Forbid any caching along the path (CDN, proxy, browser) so the one-time
  // secret is never persisted outside the agent's DPAPI/Keychain store
  // (pentest H9). Transport is HTTPS in prod; this closes the at-rest-in-cache
  // gap. A future asymmetric-enrollment redesign would remove the cleartext
  // return entirely, but that is a larger change to the (undeployed) bridge.
  return NextResponse.json(
    {
      ok: true,
      pvsSecretHex: result.pvsSecretHex,
      vendor: result.vendor,
      endpoint: "/api/pvs/events",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
      },
    }
  );
}
