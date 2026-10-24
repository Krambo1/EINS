import type { FastifyReply, FastifyRequest } from "fastify";
import { db, INACTIVE_LINK_STATUSES } from "../db/client.js";
import { verifySignature, verifyEchoedSecret } from "../canonical/sign.js";
import { postAll } from "../portal-client.js";
import { redAdapter } from "../adapters/red/index.js";

/**
 * Inbound: RED FHIR Subscription delivery.
 *
 * URL: POST /webhooks/red/:linkId
 *
 * Same shape as the HealthHub webhook; both vendors use the FHIR
 * Subscription Resource. RED registers `x-red-secret: <outboundSecret>` in
 * channel.header and replays it verbatim on delivery, so the primary auth
 * check is a timing-safe comparison of that echoed secret against the stored
 * per-clinic outboundSecret. A valid body-HMAC in `x-red-signature` is also
 * accepted (defense in depth). Previously only the HMAC path existed, so
 * every real delivery 401'd (H16).
 *
 * The route is public, so it does not help a caller probe it: an unknown
 * linkId, a link of another vendor, a link without a secret and a wrong secret
 * all answer with the same 401, and a per-IP token bucket sits in front of the
 * DB lookup so unauthenticated traffic cannot turn into unbounded queries.
 */

/** Burst a single client address may send before it is slowed down. Generous
 *  on purpose: RED delivers from a few shared addresses for all its practices,
 *  and a 429 only makes the vendor retry later. */
const RATE_BURST = 120;
/** Sustained requests per second per address once the burst is used up. */
const RATE_PER_SEC = 2;
/** Upper bound on tracked addresses (memory), idle ones are pruned first. */
const RATE_MAX_KEYS = 5_000;

const buckets = new Map<string, { tokens: number; at: number }>();

/** Test-only. */
export function _resetRedRateLimit(): void {
  buckets.clear();
}

function allowRequest(key: string, now = Date.now()): boolean {
  const b = buckets.get(key) ?? { tokens: RATE_BURST, at: now };
  b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
  b.at = now;
  const allowed = b.tokens >= 1;
  if (allowed) b.tokens -= 1;
  buckets.delete(key); // re-insert: Map order doubles as least-recently-used order
  buckets.set(key, b);
  if (buckets.size > RATE_MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  return allowed;
}

/** Fly's proxy sets fly-client-ip (a caller cannot forge it); otherwise the socket peer. */
function clientKey(req: FastifyRequest): string {
  const h = req.headers["fly-client-ip"];
  return (typeof h === "string" && h.trim() !== "" ? h.trim() : req.ip) || "unknown";
}

/** One answer for every way a request can fail authentication. */
function unauthorized(reply: FastifyReply): void {
  void reply.code(401).send({ error: "bad_signature" });
}

export async function redWebhook(
  req: FastifyRequest<{ Params: { linkId: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!allowRequest(clientKey(req))) {
    return void reply.code(429).header("retry-after", "1").send({ error: "rate_limited" });
  }
  const linkId = req.params.linkId;
  const rawBody = (req.body as string) ?? "";
  const echoedSecret =
    (req.headers["x-red-secret"] as string | undefined) ?? null;
  const sigHeader =
    (req.headers["x-red-signature"] as string | undefined) ??
    (req.headers["x-eins-signature"] as string | undefined) ??
    null;

  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    preferred_path: string;
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT id, clinic_id, pvs_vendor, status, preferred_path, connection_config
    FROM pvs_link WHERE id = ${linkId} LIMIT 1
  `;
  const link = rows[0]
    ? {
        id: rows[0].id,
        clinicId: rows[0].clinic_id,
        pvsVendor: rows[0].pvs_vendor,
        status: rows[0].status,
        preferredPath:
          rows[0].preferred_path === "rest" || rows[0].preferred_path === "db_read"
            ? (rows[0].preferred_path as "rest" | "db_read")
            : ("auto" as const),
        connectionConfig: rows[0].connection_config,
      }
    : null;
  const outboundSecret =
    link && link.pvsVendor === "red" && typeof link.connectionConfig?.outboundSecret === "string"
      ? (link.connectionConfig.outboundSecret as string)
      : null;
  if (!link || link.pvsVendor !== "red" || !outboundSecret) {
    // Same 401 as a bad secret, so the status code does not reveal which
    // linkIds exist. (A RED link without a secret is an operator problem: log
    // it here, not in the response.)
    if (link?.pvsVendor === "red") {
      console.warn(`[inbound] red link ${link.id} has no outbound secret configured`);
    }
    return unauthorized(reply);
  }
  const authorized =
    verifyEchoedSecret(echoedSecret, outboundSecret) ||
    verifySignature(rawBody, sigHeader, outboundSecret);
  if (!authorized) {
    return unauthorized(reply);
  }

  // Don't process deliveries for a link that is disabled, errored, or
  // disconnected. Ack with 200 so the FHIR Subscription treats it as
  // delivered and stops retrying a dead link (a non-2xx would retry-storm).
  if (INACTIVE_LINK_STATUSES.has(link.status)) {
    console.warn(
      `[inbound] red delivery for inactive link ${link.id} (status=${link.status}); ignoring`
    );
    return void reply.code(200).send({ ok: true, ignored: true, reason: "link_inactive" });
  }

  let events;
  try {
    events = redAdapter.decodePush!(link, rawBody, req.headers as Record<string, string>);
  } catch (err) {
    // Malformed-but-correctly-signed body. A 5xx would make the FHIR
    // Subscription redeliver the same poison forever. Ack with a non-retryable
    // 400 so the vendor drops it.
    console.warn(
      `[inbound] red delivery for link ${link.id} could not be decoded; dropping as poison:`,
      (err as Error).message
    );
    return void reply.code(400).send({ error: "malformed_body" });
  }
  if (events.length === 0) return void reply.code(200).send({ ok: true });
  const out = await postAll(link.clinicId, events);
  // Retry the WHOLE bundle if ANY event failed to post (not only when all
  // fail): a partially-failed bundle would otherwise never be redelivered and
  // those events are lost. The vendor re-sends the bundle; portal-side dedup
  // absorbs the events that already succeeded.
  if (out.errors > 0) {
    console.warn(
      `[inbound] red link ${link.id}: ${out.errors}/${events.length} event(s) failed to post; asking vendor to retry`
    );
    return void reply.code(503).send({ error: "portal_unavailable", ...out });
  }
  return void reply.code(200).send({ ok: true, ...out });
}
