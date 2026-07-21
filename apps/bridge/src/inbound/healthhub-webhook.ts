import type { FastifyReply, FastifyRequest } from "fastify";
import { db, getLinkByClinicAndVendor, INACTIVE_LINK_STATUSES } from "../db/client.js";
import { verifySignature, verifyEchoedSecret } from "../canonical/sign.js";
import { postAll } from "../portal-client.js";
import { healthHubAdapter } from "../adapters/healthhub/index.js";

/**
 * Inbound: HealthHub FHIR Subscription delivery.
 *
 * URL: POST /webhooks/healthhub/:linkId
 *
 * HealthHub is a FHIR server: it replays the Subscription's registered
 * `channel.header` verbatim on every delivery, it does NOT compute a body
 * HMAC. The subscription registers `x-healthhub-secret: <outboundSecret>`
 * (see adapters/healthhub/subscription.ts), so the primary auth check is a
 * timing-safe comparison of that echoed secret against the stored
 * per-clinic outboundSecret. We ALSO accept a valid body-HMAC in
 * `x-healthhub-signature` as an additional path (defense in depth, harmless
 * if a future/proxy layer signs bodies); previously ONLY the HMAC path
 * existed, so every real FHIR delivery 401'd and the server disabled the
 * subscription (H16).
 *
 * On success: events are POSTed to the portal and we return 200.
 * On auth failure: 401.
 * On portal failure: 503 (HealthHub will retry).
 */
export async function healthHubWebhook(
  req: FastifyRequest<{ Params: { linkId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const linkId = req.params.linkId;
  const rawBody = (req.body as string) ?? "";
  // Primary: the plaintext secret HealthHub echoes back from channel.header.
  const echoedSecret =
    (req.headers["x-healthhub-secret"] as string | undefined) ?? null;
  // Additional accepted path: a body-HMAC, if some layer ever signs bodies.
  const sigHeader =
    (req.headers["x-healthhub-signature"] as string | undefined) ??
    (req.headers["x-eins-signature"] as string | undefined) ??
    null;

  // Resolve the link row to fetch the outbound secret.
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
  if (!link || link.pvsVendor !== "healthhub") {
    return void reply.code(404).send({ error: "not_found" });
  }
  const outboundSecret =
    typeof link.connectionConfig?.outboundSecret === "string"
      ? (link.connectionConfig.outboundSecret as string)
      : null;
  if (!outboundSecret) {
    return void reply.code(500).send({ error: "no_outbound_secret_configured" });
  }
  const authorized =
    verifyEchoedSecret(echoedSecret, outboundSecret) ||
    verifySignature(rawBody, sigHeader, outboundSecret);
  if (!authorized) {
    return void reply.code(401).send({ error: "bad_signature" });
  }

  // Don't process deliveries for a link that is disabled, errored, or
  // disconnected. Ack with 200 so the FHIR Subscription treats it as
  // delivered and stops retrying a dead link (a non-2xx would retry-storm).
  if (INACTIVE_LINK_STATUSES.has(link.status)) {
    console.warn(
      `[inbound] healthhub delivery for inactive link ${link.id} (status=${link.status}); ignoring`
    );
    return void reply.code(200).send({ ok: true, ignored: true, reason: "link_inactive" });
  }

  let events;
  try {
    events = healthHubAdapter.decodePush!(link, rawBody, req.headers as Record<string, string>);
  } catch (err) {
    // Malformed-but-correctly-signed body. A 5xx would make the FHIR
    // Subscription redeliver the same poison forever. Ack with a non-retryable
    // 400 so the vendor drops it.
    console.warn(
      `[inbound] healthhub delivery for link ${link.id} could not be decoded; dropping as poison:`,
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
      `[inbound] healthhub link ${link.id}: ${out.errors}/${events.length} event(s) failed to post; asking vendor to retry`
    );
    return void reply.code(503).send({ error: "portal_unavailable", ...out });
  }
  return void reply.code(200).send({ ok: true, ...out });
}
