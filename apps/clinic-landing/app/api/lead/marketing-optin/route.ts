import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClinic, getTreatment } from "@/lib/clinic-registry";
import { sendDoiEmail, signDoiToken } from "@/lib/doi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Post-submit marketing opt-in.
 *
 * Quiz v2 moved the marketing checkbox OUT of the contact step onto the
 * confirmation screen. This endpoint sends the same signed double-opt-in
 * email the in-quiz checkbox used to trigger — consent only becomes
 * effective when the patient clicks the confirmation link (§ 7 UWG), so
 * this endpoint itself grants nothing.
 *
 * Abuse surface is "make us email an address" — bounded by: same-origin
 * check, per-IP rate limit (tighter than the lead route), and per-email
 * dedup so one address can't be spammed with DOI mails.
 */

const optInSchema = z.object({
  clinicSlug: z.string().regex(/^[a-z0-9-_]+$/),
  treatmentSlug: z.string().regex(/^[a-z0-9-]+$/),
  email: z.string().email().max(120),
  firstName: z.string().min(1).max(60).optional(),
  eventId: z.string().min(1).max(200),
});

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const ipBuckets = new Map<string, number[]>();

function ipRateLimitOk(ip: string): boolean {
  if (!ip) return true;
  const now = Date.now();
  const bucket = (ipBuckets.get(ip) ?? []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT_MAX) {
    ipBuckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  ipBuckets.set(ip, bucket);
  if (ipBuckets.size > 5000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [k, v] of ipBuckets.entries()) {
      if (v[v.length - 1]! < cutoff) ipBuckets.delete(k);
    }
  }
  return true;
}

/** One DOI mail per email address per window (per warm instance, best-effort). */
const SEEN_EMAILS = new Map<string, number>();
const EMAIL_DEDUP_WINDOW_MS = 1000 * 60 * 60 * 6;

function emailFresh(email: string): boolean {
  const now = Date.now();
  for (const [k, ts] of SEEN_EMAILS.entries()) {
    if (now - ts > EMAIL_DEDUP_WINDOW_MS) SEEN_EMAILS.delete(k);
  }
  const key = email.toLowerCase().trim();
  if (SEEN_EMAILS.has(key)) return false;
  SEEN_EMAILS.set(key, now);
  return true;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "";
}

function originLooksLegit(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return true;
  for (const headerName of ["origin", "referer"]) {
    const v = req.headers.get(headerName);
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function POST(req: NextRequest) {
  if (!originLooksLegit(req)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parse = optInSchema.safeParse(raw);
  if (!parse.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const { clinicSlug, treatmentSlug, email, firstName, eventId } = parse.data;

  const clinic = getClinic(clinicSlug);
  const treatment = getTreatment(clinicSlug, treatmentSlug);
  if (!clinic || !treatment) {
    return NextResponse.json({ error: "unknown_clinic_or_treatment" }, { status: 404 });
  }

  if (!ipRateLimitOk(clientIp(req))) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }

  // Idempotent success for a repeated click — the first DOI mail is on its way.
  if (!emailFresh(email)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const token = signDoiToken({ e: email, c: clinic.slug, t: treatment.slug, id: eventId });
    const confirmUrl = `${req.nextUrl.origin}/api/lead/confirm-marketing?t=${encodeURIComponent(token)}`;
    const sent = await sendDoiEmail({ to: email, firstName, clinic, confirmUrl });
    if (!sent.ok) {
      console.error("[marketing-optin] DOI send failed:", sent.message);
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    }
  } catch (err) {
    console.error("[marketing-optin] DOI dispatch failed:", (err as Error).message);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
