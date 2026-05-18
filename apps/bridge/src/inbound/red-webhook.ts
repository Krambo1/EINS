import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/client.js";
import { verifySignature } from "../canonical/sign.js";
import { postAll } from "../portal-client.js";
import { redAdapter } from "../adapters/red/index.js";

/**
 * Inbound: RED FHIR Subscription delivery.
 *
 * URL: POST /webhooks/red/:linkId
 *
 * Same shape as the HealthHub webhook; both vendors use the FHIR
 * Subscription Resource. RED uses `x-red-signature: sha256=<hex>`.
 */
export async function redWebhook(
  req: FastifyRequest<{ Params: { linkId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const linkId = req.params.linkId;
  const rawBody = (req.body as string) ?? "";
  const sigHeader =
    (req.headers["x-red-signature"] as string | undefined) ??
    (req.headers["x-eins-signature"] as string | undefined) ??
    null;

  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT id, clinic_id, pvs_vendor, status, connection_config
    FROM pvs_link WHERE id = ${linkId} LIMIT 1
  `;
  const link = rows[0]
    ? {
        id: rows[0].id,
        clinicId: rows[0].clinic_id,
        pvsVendor: rows[0].pvs_vendor,
        status: rows[0].status,
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
  if (!verifySignature(rawBody, sigHeader, outboundSecret)) {
    return void reply.code(401).send({ error: "bad_signature" });
  }

  const events = redAdapter.decodePush!(link, rawBody, req.headers as Record<string, string>);
  if (events.length === 0) return void reply.code(200).send({ ok: true });
  const out = await postAll(link.clinicId, events);
  if (out.errors === events.length) {
    return void reply.code(503).send({ error: "portal_unavailable" });
  }
  return void reply.code(200).send({ ok: true, ...out });
}
