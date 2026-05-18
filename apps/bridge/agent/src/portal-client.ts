import { createHmac } from "node:crypto";
import { loadSecret } from "./secure-store.js";
import { loadConfig } from "./config.js";

/**
 * HMAC-signed POST to the portal's /api/pvs/events endpoint. Used by the
 * outbox flush loop. We duplicate this from apps/bridge so the agent is
 * a single-binary, zero-monorepo-dep deliverable.
 */

export type PostResult =
  | { ok: true; deduped: boolean }
  | { ok: false; retryable: boolean; reason: string };

export async function postEvent(rawJson: string): Promise<PostResult> {
  const config = await loadConfig();
  if (!config) return { ok: false, retryable: false, reason: "no_config" };
  const secret = await loadSecret();
  if (!secret) return { ok: false, retryable: false, reason: "no_secret" };

  const sig = `sha256=${createHmac("sha256", secret).update(rawJson).digest("hex")}`;
  let res: Response;
  try {
    res = await fetch(`${config.portalBaseUrl.replace(/\/$/, "")}/api/pvs/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eins-signature": sig,
      },
      body: rawJson,
    });
  } catch (err) {
    return { ok: false, retryable: true, reason: `network: ${(err as Error).message}` };
  }
  if (res.status === 429 || res.status >= 500) {
    return {
      ok: false,
      retryable: true,
      reason: `http ${res.status}`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      retryable: false,
      reason: `http ${res.status}: ${await res.text().catch(() => "")}`,
    };
  }
  const body = (await res.json().catch(() => ({}))) as { status?: string };
  return { ok: true, deduped: body.status === "deduped" };
}
