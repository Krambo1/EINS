import Fastify from "fastify";
import { env } from "../config.js";
import { healthHubWebhook } from "./healthhub-webhook.js";
import { redWebhook } from "./red-webhook.js";

/**
 * Inbound Fastify server.
 *
 *   POST /webhooks/healthhub/:linkId  → HealthHub FHIR Subscription delivery
 *   POST /webhooks/red/:linkId        → RED FHIR Subscription delivery
 *   GET  /healthz                     → liveness check (for the load balancer)
 *
 * Each push adapter route:
 *   1. Verifies the vendor's outbound signature against the vendor-specific
 *      secret stored in pvs_link.connection_config.outbound_secret.
 *   2. Translates the FHIR Bundle into canonical events.
 *   3. Posts the events to the portal via postBatch.
 *
 * The route returns 200 to the vendor only after the portal acks; if the
 * portal is down, we return 503 so the vendor retries.
 */

export async function startInbound(): Promise<{ stop: () => Promise<void> }> {
  const app = Fastify({
    logger: env().NODE_ENV === "production",
    bodyLimit: 5 * 1024 * 1024, // 5 MB cap on FHIR Bundle size
  });

  // Raw-body retention so we can compute HMAC over exactly what the
  // vendor sent. Fastify's content-type parser hooks let us short-circuit
  // before JSON.parse runs.
  app.addContentTypeParser(
    "application/fhir+json",
    { parseAs: "string" },
    (_req, body, done) => done(null, body)
  );
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => done(null, body)
  );

  app.get("/healthz", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.post("/webhooks/healthhub/:linkId", healthHubWebhook);
  app.post("/webhooks/red/:linkId", redWebhook);

  await app.listen({ host: "0.0.0.0", port: env().PORT });
  console.log(`[inbound] listening on :${env().PORT}`);
  return { stop: async () => void (await app.close()) };
}
