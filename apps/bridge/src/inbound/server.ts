import Fastify from "fastify";
import { env } from "../config.js";
import { healthHubWebhook } from "./healthhub-webhook.js";
import { redWebhook } from "./red-webhook.js";
import { computeHealth } from "../health.js";
import { pingDb, failingLinkSummary } from "../db/client.js";

/**
 * Inbound Fastify server.
 *
 *   POST /webhooks/healthhub/:linkId  → HealthHub FHIR Subscription delivery
 *   POST /webhooks/red/:linkId        → RED FHIR Subscription delivery
 *   GET  /healthz                     → 503 when the scheduler stopped ticking
 *                                       (no tick in 3 tick intervals) or the DB
 *                                       does not answer SELECT 1 within 2 s
 *
 * The HealthHub route is only registered with ENABLE_HEALTHHUB_WEBHOOK=true
 * (shelved vendor; default off so it is not an exposed, unused surface).
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

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export async function startInbound(): Promise<{ stop: () => Promise<void> }> {
  const app = Fastify({
    logger: env().NODE_ENV === "production",
    bodyLimit: 1024 * 1024, // 1 MB cap on FHIR Bundle size
    // Fastify's defaults are 0 (= no timeout): a slowloris client could hold a
    // socket and a handler forever.
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
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

  app.get("/healthz", async (_req, reply) => {
    const report = await computeHealth({
      tickMs: env().SCHEDULER_TICK_MS,
      ping: () => pingDb(2_000),
      failingSummary: () => failingLinkSummary(env().FAIL_THRESHOLD),
    });
    return reply.code(report.status).send(report.body);
  });

  // linkId is a uuid; reject anything else before any DB query is made.
  const linkParams = {
    schema: {
      params: {
        type: "object",
        properties: { linkId: { type: "string", pattern: UUID_PATTERN } },
        required: ["linkId"],
      },
    },
  };
  if (env().ENABLE_HEALTHHUB_WEBHOOK) {
    app.post("/webhooks/healthhub/:linkId", linkParams, healthHubWebhook);
  }
  app.post("/webhooks/red/:linkId", linkParams, redWebhook);

  await app.listen({ host: "0.0.0.0", port: env().PORT });
  console.log(`[inbound] listening on :${env().PORT}`);
  return { stop: async () => void (await app.close()) };
}
