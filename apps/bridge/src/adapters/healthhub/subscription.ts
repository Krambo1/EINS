import { env } from "../../config.js";
import type { PvsLinkRow } from "../../db/client.js";
import { HealthHubFhirClient } from "./fhir-client.js";
import { fetchWithTimeout } from "../../http.js";

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
    const baseUrl = env().BRIDGE_PUBLIC_URL.replace(/\/$/, "");
    const channelUrl = `${baseUrl}/webhooks/healthhub/${link.id}`;

    // Idempotency: this handshake can be re-run (setup wizard retry, credential
    // rotation, redeploy). Without a pre-check every run POSTs four fresh
    // Subscription resources, so medatixx ends up fanning out N duplicate
    // deliveries per event. Query the subscriptions already pointing at THIS
    // link's endpoint and reuse them; only create the resource types that are
    // missing. Matching is on the channel endpoint plus the resource type
    // embedded in `criteria` (e.g. "Patient?_lastUpdated=gt...").
    const existing = await client.findSubscriptionsByEndpoint(channelUrl);
    const byResType = new Map<string, { id: string; status: string }>();
    for (const sub of existing) {
      const resType = sub.criteria.split("?")[0]?.trim();
      if (resType && !byResType.has(resType)) {
        byResType.set(resType, { id: sub.id, status: sub.status });
      }
    }

    const ids: string[] = [];
    for (const resType of RESOURCE_TYPES) {
      const found = byResType.get(resType);
      if (found) {
        console.log(
          `[subscription] healthhub link=${link.id} ${resType}: reusing existing subscription ${found.id} (status=${found.status})`
        );
        ids.push(found.id);
        continue;
      }
      const subscription = {
        resourceType: "Subscription",
        status: "requested",
        reason: `EINS: ${resType} sync for ROAS attribution`,
        criteria: `${resType}?_lastUpdated=gt${new Date(0).toISOString()}`,
        channel: {
          type: "rest-hook",
          endpoint: channelUrl,
          payload: "application/fhir+json",
          header: [`x-healthhub-secret: ${outboundSecret}`],
        },
      };
      const id = await client.createSubscription(subscription);
      console.log(
        `[subscription] healthhub link=${link.id} ${resType}: created subscription ${id}`
      );
      ids.push(id);
    }

    // Out of scope here (kept deliberately minimal): FHIR Subscriptions expire
    // and can be deactivated server-side ('error'/'off' status). A full fix
    // persists these ids on pvs_link.connection_config and runs a periodic
    // renewal + status monitor that re-issues a subscription whose status is no
    // longer 'active'/'requested'. This function now at least never stacks
    // duplicates and returns the ids so the caller can persist them.
    return { ok: true, subscriptionIds: ids };
  } catch (err) {
    return {
      ok: false,
      subscriptionIds: [],
      error: (err as Error).message,
    };
  }
}

/** A Subscription already registered on the FHIR server for our endpoint. */
export interface ExistingSubscription {
  id: string;
  status: string;
  criteria: string;
}

// Inject the create + search methods onto HealthHubFhirClient so this file owns
// the vendor-specific subscription shape. (Side-effect import: ensures the
// methods are defined before any caller of setupSubscription runs.)
declare module "./fhir-client.js" {
  interface HealthHubFhirClient {
    createSubscription(body: unknown): Promise<string>;
    findSubscriptionsByEndpoint(
      channelUrl: string
    ): Promise<ExistingSubscription[]>;
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
  const res = await fetchWithTimeout(
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

// Search the FHIR server for Subscriptions whose channel endpoint is our
// webhook URL, so setup can reuse them instead of stacking duplicates. A failed
// search throws (aborting setup with ok:false) rather than returning [] so we
// never silently re-create on a server that rejects the search and stack
// duplicate subscriptions.
(HealthHubFhirClient.prototype as unknown as {
  findSubscriptionsByEndpoint: (
    channelUrl: string
  ) => Promise<ExistingSubscription[]>;
}).findSubscriptionsByEndpoint = async function findSubscriptionsByEndpoint(
  this: HealthHubFhirClient,
  channelUrl: string
): Promise<ExistingSubscription[]> {
  const cfg = (this as unknown as { cfg: { baseUrl: string } }).cfg;
  const ensureToken = (
    this as unknown as { ensureToken: () => Promise<void> }
  ).ensureToken.bind(this);
  await ensureToken();
  const token = (this as unknown as { accessToken: string }).accessToken;
  const url =
    `${cfg.baseUrl.replace(/\/$/, "")}/Subscription` +
    `?url=${encodeURIComponent(channelUrl)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/fhir+json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `healthhub subscription search ${res.status}: ${await res.text()}`
    );
  }
  const bundle = (await res.json()) as {
    entry?: Array<{
      resource?: { id?: string; status?: string; criteria?: string };
    }>;
  };
  const out: ExistingSubscription[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (r?.id && typeof r.criteria === "string") {
      out.push({ id: r.id, status: r.status ?? "unknown", criteria: r.criteria });
    }
  }
  return out;
};
