import { NextResponse, type NextRequest } from "next/server";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { describeErrorForLog } from "@/lib/error-log";
import { parseMesswegProvider, type MesswegProvider } from "@/lib/messweg";
import { MESSWEG_ADAPTERS } from "@/lib/messweg-adapters";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { ClinicArchivedError } from "@/server/leads";
import { ingestMesswegEvent, MesswegBusyError } from "@/server/messweg/ingest";

/**
 * Messweg webhook: calls on an EINS tracking number (Matelso) and bookings
 * over the EINS booking link (Calendly) become Anfragen with source
 * 'anruf' / 'buchung', Messweg confidence (KANON § 5, Messwege 2 and 3).
 *
 * Security: body cap, a per-IP gate, then the provider's own authenticity
 * check (lib/messweg-adapters.ts) BEFORE parsing anything into the DB. The
 * per-provider bucket counts only authentic deliveries, so unsigned junk
 * cannot use it up and get real calls and bookings answered 429 (as B-17
 * for the intake route). An unconfigured provider answers 503 so a misconfigured push shows
 * up in the provider's delivery log instead of vanishing.
 *
 * Responses: 200 for anything authentic, including deliveries EINS ignores
 * (cancellations, a number not assigned to a Praxis), so the provider does
 * not retry them forever. 401 on a failed check, 500 on our own failure
 * (the provider retries; ingest is idempotent).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;

function secretFor(provider: MesswegProvider): string | null {
  switch (provider) {
    case "matelso":
      return env.MATELSO_WEBHOOK_TOKEN ?? null;
    case "calendly":
      return env.CALENDLY_WEBHOOK_SIGNING_KEY ?? null;
    case "fixture":
      // Test and local runs only.
      return process.env.NODE_ENV === "production" ? null : env.MESSWEG_FIXTURE_SECRET ?? null;
  }
}

function rateLimited(resetInSeconds: number) {
  return NextResponse.json(
    { error: { code: "rate_limited" } },
    { status: 429, headers: { "Retry-After": String(resetInSeconds) } }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = parseMesswegProvider((await params).provider);
  if (!provider) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  const secret = secretFor(provider);
  if (!secret) {
    return NextResponse.json({ error: { code: "not_configured" } }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "too_large" } }, { status: 413 });
  }

  // Per-IP gate on the trusted client IP, before reading the body (I-9).
  const callerIp = trustedIpFromHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip")
  );
  if (callerIp) {
    const ipRl = await rateLimit("messweg-webhook-ip", callerIp, { limit: 600, windowSeconds: 600 });
    if (!ipRl.ok) return rateLimited(ipRl.resetInSeconds);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "too_large" } }, { status: 413 });
  }

  const adapter = MESSWEG_ADAPTERS[provider];
  if (!adapter.verify(raw, request.headers, secret, new Date())) {
    console.warn(`[messweg] ${provider}: authenticity check failed`);
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const rl = await rateLimit("messweg-webhook", provider, { limit: 600, windowSeconds: 600 });
  if (!rl.ok) return rateLimited(rl.resetInSeconds);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, outcome: "ignoriert" }, { status: 200 });
  }

  const mapped = adapter.parse(body);
  if (mapped.type === "ignore") {
    console.info(`[messweg] ${provider}: ignored (${mapped.reason})`);
    return NextResponse.json({ ok: true, outcome: "ignoriert" }, { status: 200 });
  }

  try {
    const result = await ingestMesswegEvent(mapped.event);
    if (result.clinicId && !result.replay) {
      await writeAudit({
        clinicId: result.clinicId,
        action: "messweg_event",
        entityKind: "request",
        entityId: result.requestId ?? undefined,
        diff: { provider, kind: mapped.event.kind, outcome: result.outcome },
        requestMeta: { ip: null, ua: request.headers.get("user-agent") ?? null },
      });
    }
    return NextResponse.json({ ok: true, outcome: result.outcome }, { status: 200 });
  } catch (err) {
    if (err instanceof ClinicArchivedError) {
      return NextResponse.json({ ok: true, outcome: "ignoriert" }, { status: 200 });
    }
    if (err instanceof MesswegBusyError) {
      // Same delivery in flight in another run: let the provider retry.
      return NextResponse.json(
        { error: { code: "in_progress" } },
        { status: 503, headers: { "Retry-After": "60" } }
      );
    }
    console.error(`[messweg] ${provider}: ingest failed`, JSON.stringify(describeErrorForLog(err)));
    return NextResponse.json({ error: { code: "internal" } }, { status: 500 });
  }
}
