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
 */
export async function redWebhook(
  req: FastifyRequest<{ Params: { linkId: string } }>,
  reply: FastifyReply
): Promise<void> {
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
  if (!link || link.pvsVendor !== "red") {
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
