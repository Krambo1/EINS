import "server-only";
import { createHash } from "node:crypto";

/**
 * Portal-side Meta Conversions API client.
 *
 * Mirrors apps/clinic-landing/lib/meta-capi.ts deliberately: same hashing,
 * same wire shape, same timeout. Kept as its own module because the apps
 * don't share code at build time. When you change one, change the other.
 *
 * Used by the capi-purchase worker to fire a server-side `Purchase` event
 * back to Meta when a PVS InvoicePaid arrives. The browser pixel will not
 * have fired this event (the patient is in the praxis, not on the site),
 * so dedup against a client-side counterpart is not needed; we still send
 * a deterministic `event_id` so a retry of the same InvoicePaid is
 * idempotent on Meta's side (7-day window).
 */

export interface CapiUserData {
  /** SHA-256 of lowercased email. */
  em?: string[];
  /** SHA-256 of digits-only phone. */
  ph?: string[];
  /** SHA-256 of lowercased first-name. */
  fn?: string[];
  /** SHA-256 of lowercased city. */
  ct?: string[];
  /** Meta click id from `_fbc` cookie or rebuilt from fbclid. */
  fbc?: string;
  /** Meta browser id from `_fbp` cookie. */
  fbp?: string;
  client_user_agent?: string;
  client_ip_address?: string;
}

export interface CapiEvent {
  event_name: "Purchase" | "Lead" | "Schedule" | "CompleteRegistration";
  /** Stable across retries — Meta dedupes within 7 days. */
  event_id: string;
  event_time: number;
  event_source_url?: string;
  action_source?: "website" | "physical_store" | "system_generated";
  user_data: CapiUserData;
  custom_data?: {
    value?: number;
    currency?: string;
    order_id?: string;
    [k: string]: unknown;
  };
}

function sha256Lower(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
}

export function hashEmail(email: string): string {
  return sha256Lower(email);
}

export function hashPhone(phoneE164OrDigits: string): string {
  // Meta wants digits only, no `+`, no spaces.
  return sha256Lower(phoneE164OrDigits.replace(/\D/g, ""));
}

export function hashName(name: string): string {
  return sha256Lower(name);
}

/**
 * Meta accepts the unhashed `fbc` cookie value (e.g. `fb.1.1554763741205.AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`).
 * If we only have a bare `fbclid` from the URL, rebuild the canonical
 * format Meta expects: `fb.{subdomainIndex}.{timestampMs}.{fbclid}`.
 *
 * Subdomain index 1 = `.com`-level cookies (the default for clinic-landing).
 */
export function rebuildFbcFromFbclid(fbclid: string, eventTimeSeconds: number): string {
  return `fb.1.${eventTimeSeconds * 1000}.${fbclid}`;
}

export interface SendCapiArgs {
  pixelId: string;
  accessToken: string;
  apiVersion: string;
  events: CapiEvent[];
  /** When non-empty, Meta marks the request as a test-event in Events Manager. */
  testEventCode?: string;
}

export interface SendCapiResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function sendCapi(args: SendCapiArgs): Promise<SendCapiResult> {
  const url = `https://graph.facebook.com/${args.apiVersion}/${args.pixelId}/events`;
  const body = {
    data: args.events.map((e) => ({
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
      // Don't let a hanging Meta request stall a worker — pg-boss will
      // retry on throw. 5s is more generous than the lead-intake path
      // (3.5s) because the worker isn't on a user-facing request.
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, body: { error: (err as Error).message } };
  }
}
