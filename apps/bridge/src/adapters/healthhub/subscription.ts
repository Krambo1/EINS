import { env } from "../../config.js";
import type { PvsLinkRow } from "../../db/client.js";
import { HealthHubFhirClient } from "./fhir-client.js";

/**
 * One-shot subscription handshake.
 *
 * Called from the setup wizard after the inhaber has entered HealthHub
 * credentials. Creates four FHIR Subscription resources (one per resource
 * type) pointing at the Bridge's inbound webhook URL. medatixx will then
 * POST event notifications to that endpoint with a vendor-side HMAC.
 *
 * The subscription's `channel.endpoint` is the public Bridge URL plus the
 * link's UUID, and the `channel.header` includes a one-time secret which
 * medatixx echoes back in `x-healthhub-signature`. We store that secret
 * in pvs_link.connection_config.outboundSecret so the inbound handler
 * can verify deliveries.
 */
const RESOURCE_TYPES = ["Patient", "Appointment", "Encounter", "Invoice"];

export async function setupSubscription(
  link: PvsLinkRow,
  outboundSecret: string
): Promise<{ ok: boolean; subscriptionIds: string[]; error?: string }> {
  try {
    const client = HealthHubFhirClient.from(link);
    const ids: string[] = [];
    const baseUrl = env().BRIDGE_PUBLIC_URL.replace(/\/$/, "");
    for (const resType of RESOURCE_TYPES) {
      const channelUrl = `${baseUrl}/webhooks/healthhub/${link.id}`;
      const subscription = {
        resourceType: "Subscription",
        status: "requested",
        reason: `EINS Visuals — ${resType} sync for ROAS attribution`,
        criteria: `${resType}?_lastUpdated=gt${new Date(0).toISOString()}`,
        channel: {
          type: "rest-hook",
          endpoint: channelUrl,
          payload: "application/fhir+json",
          header: [`x-healthhub-secret: ${outboundSecret}`],
        },
      };
      const id = await client.createSubscription(subscription);
      ids.push(id);
    }
    return { ok: true, subscriptionIds: ids };
  } catch (err) {
    return {
      ok: false,
      subscriptionIds: [],
      error: (err as Error).message,
    };
  }
}

// Inject the create method onto HealthHubFhirClient so this file owns the
// vendor-specific subscription shape. (Side-effect import: ensures the
// method is defined before any caller of setupSubscription runs.)
declare module "./fhir-client.js" {
  interface HealthHubFhirClient {
    createSubscription(body: unknown): Promise<string>;
  }
}

// Patch the prototype.
(HealthHubFhirClient.prototype as unknown as {
  createSubscription: (body: unknown) => Promise<string>;
}).createSubscription = async function createSubscription(
  this: HealthHubFhirClient,
  body: unknown
): Promise<string> {
  const cfg = (this as unknown as { cfg: { baseUrl: string } }).cfg;
  const ensureToken = (
    this as unknown as { ensureToken: () => Promise<void> }
  ).ensureToken.bind(this);
  await ensureToken();
  const token = (this as unknown as { accessToken: string }).accessToken;
  const res = await fetch(
    `${cfg.baseUrl.replace(/\/$/, "")}/Subscription`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/fhir+json",
        accept: "application/fhir+json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`healthhub subscription ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
};
