import { createHmac } from "node:crypto";

/**
 * L-16: signature for the Praxis-CRM webhooks (raw adapter and the
 * "marketing-confirmed" event).
 *
 * Header:  X-EINS-Signature: sha256=<hex>
 *          hex = HMAC-SHA256(secret, exact request body), same scheme as the
 *          landing -> portal intake relay (lib/portal-intake.ts signBody).
 * Secret:  env `LEAD_WEBHOOK_SECRET_<SLUG>` (slug upper-case, "-" -> "_"),
 *          else `LEAD_WEBHOOK_SECRET`. Without either, the request goes out
 *          unsigned, as before (existing receivers keep working).
 * Replay:  the signed body carries `receivedAt` (ISO time); receivers should
 *          reject bodies older than a few minutes.
 *
 * Receiver check (n8n Code node, Node):
 *   const mac = require("crypto").createHmac("sha256", SECRET)
 *     .update(rawBody).digest("hex");
 *   valid = header === "sha256=" + mac   // compare in constant time
 */
export const SIGNATURE_HEADER = "X-EINS-Signature";

export function webhookSecretForClinic(
  clinicSlug: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const key = `LEAD_WEBHOOK_SECRET_${clinicSlug.toUpperCase().replace(/-/g, "_")}`;
  return env[key] || env.LEAD_WEBHOOK_SECRET || undefined;
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Headers for a JSON webhook POST of `body`, signed when a secret exists. */
export function webhookHeaders(
  clinicSlug: string,
  body: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = webhookSecretForClinic(clinicSlug, env);
  if (secret) headers[SIGNATURE_HEADER] = signWebhookBody(secret, body);
  return headers;
}
