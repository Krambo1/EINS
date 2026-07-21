import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * M-S6: subscription setup must be idempotent. A re-run has to reuse the
 * Subscriptions already pointing at this link's endpoint instead of stacking
 * fresh duplicates (which would make the FHIR server fan out N deliveries per
 * event).
 */

vi.mock("../../config.js", () => ({
  env: () => ({
    BRIDGE_PUBLIC_URL: "https://bridge.test",
  }),
}));

import { setupSubscription } from "./subscription.js";
import type { PvsLinkRow } from "../../db/client.js";

const TOKEN_URL = "https://hh.test/oauth/token";

function link(): PvsLinkRow {
  return {
    id: "link-1",
    clinicId: "00000000-0000-0000-0000-000000000009",
    pvsVendor: "healthhub",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: {
      healthHubBaseUrl: "https://hh.test/fhir",
      healthHubClientId: "cid",
      healthHubClientSecret: "csecret",
      healthHubTokenUrl: TOKEN_URL,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: "tok", expires_in: 3600 });
}

function subEntry(id: string, resType: string, status = "active") {
  return {
    resource: {
      id,
      status,
      criteria: `${resType}?_lastUpdated=gt1970-01-01T00:00:00.000Z`,
    },
  };
}

describe("setupSubscription idempotency (M-S6)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  function createCalls() {
    return fetchSpy.mock.calls.filter((c) => {
      const url = c[0] as string;
      const init = (c[1] ?? {}) as { method?: string };
      return init.method === "POST" && url.endsWith("/Subscription");
    });
  }

  it("reuses existing subscriptions and only creates the missing resource types", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse()) // ensureToken (search)
      .mockResolvedValueOnce(
        jsonResponse({
          resourceType: "Bundle",
          entry: [subEntry("sub-P", "Patient"), subEntry("sub-A", "Appointment")],
        })
      ) // Subscription search
      .mockResolvedValueOnce(jsonResponse({ id: "sub-E" })) // create Encounter
      .mockResolvedValueOnce(jsonResponse({ id: "sub-I" })); // create Invoice

    const result = await setupSubscription(link(), "outbound-secret");
    expect(result.ok).toBe(true);
    // Reused two + created two, in RESOURCE_TYPES order.
    expect(result.subscriptionIds).toEqual(["sub-P", "sub-A", "sub-E", "sub-I"]);
    // Only the two missing types were POSTed as creates.
    expect(createCalls()).toHaveLength(2);
  });

  it("creates all four when none exist yet", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Bundle", entry: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "sub-P" }))
      .mockResolvedValueOnce(jsonResponse({ id: "sub-A" }))
      .mockResolvedValueOnce(jsonResponse({ id: "sub-E" }))
      .mockResolvedValueOnce(jsonResponse({ id: "sub-I" }));

    const result = await setupSubscription(link(), "outbound-secret");
    expect(result.ok).toBe(true);
    expect(result.subscriptionIds).toEqual(["sub-P", "sub-A", "sub-E", "sub-I"]);
    expect(createCalls()).toHaveLength(4);
  });

  it("aborts (ok:false) without stacking when the subscription search fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const result = await setupSubscription(link(), "outbound-secret");
    expect(result.ok).toBe(false);
    expect(createCalls()).toHaveLength(0);
  });
});
