import { createHash } from "node:crypto";

/**
 * Direct Meta Conversions API relay — no Stape, no third-party.
 *
 * Sends server-side events to https://graph.facebook.com/v19.0/{pixelId}/events
 * with hashed PII so Meta can deduplicate against the browser pixel via `event_id`.
 *
 * Auth token lives per-clinic in env: `META_CAPI_TOKEN_<UPPERCASE_SLUG>`.
 * Slug dashes are replaced with underscores: `praxis-mueller-muenchen` →
 *   `META_CAPI_TOKEN_PRAXIS_MUELLER_MUENCHEN`.
 *
 * IMPORTANT: this function is best-effort. CAPI failure must NEVER block
 * the patient flow — the lead is already accepted by the time we get here.
 */

const META_API_VERSION = "v19.0";

export interface MetaCapiEvent {
  /** "Lead", "PageView", "QuizStep", etc. */
  event_name: string;
  /** Same `eventID` you pass to the browser pixel — used for dedup. */
  event_id: string;
  event_time?: number;
  event_source_url?: string;
  action_source?: "website";
  user_data: {
    em?: string[];
    ph?: string[];
    fn?: string[];
    ct?: string[];
    fbc?: string;
    fbp?: string;
    client_user_agent?: string;
    client_ip_address?: string;
  };
  custom_data?: Record<string, unknown>;
}

function sha256Lower(input: string): string {
  return createHash("sha256").update(input.trim().toLowerCase(), "utf8").digest("hex");
}

export function hashEmail(email: string): string {
  return sha256Lower(email);
}

export function hashPhone(phoneE164OrDigits: string): string {
  // Meta wants digits only, no `+`, no spaces.
  const digits = phoneE164OrDigits.replace(/\D/g, "");
  return sha256Lower(digits);
}

export function hashName(name: string): string {
  return sha256Lower(name);
}

export function envTokenForSlug(slug: string): string | undefined {
  const key = `META_CAPI_TOKEN_${slug.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key];
}

interface SendArgs {
  pixelId: string;
  accessToken: string;
  events: MetaCapiEvent[];
  /** When non-empty, Meta marks the request as a test-event in Events Manager. */
  testEventCode?: string;
}

export async function sendMetaCapi(args: SendArgs): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${args.pixelId}/events`;
  const body = {
    data: args.events.map((e) => ({
      event_time: e.event_time ?? Math.floor(Date.now() / 1000),
      action_source: e.action_source ?? "website",
      ...e,
    })),
    ...(args.testEventCode ? { test_event_code: args.testEventCode } : {}),
    access_token: args.accessToken,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // Don't let a hanging request from Meta block the API route.
      signal: AbortSignal.timeout(3500),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, body: { error: (err as Error).message } };
  }
}

/** Anonymize an IPv4/IPv6 address by zeroing the last 8 bits — DSGVO-compliant logging. */
export function anonymizeIp(ip: string): string {
  if (!ip) return "";
  if (ip.includes(":")) {
    // IPv6: keep first 4 hextets.
    const parts = ip.split(":");
    while (parts.length < 8) parts.push("0");
    return [...parts.slice(0, 4), "0", "0", "0", "0"].join(":");
  }
  // IPv4: zero last octet.
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  parts[3] = "0";
  return parts.join(".");
}
