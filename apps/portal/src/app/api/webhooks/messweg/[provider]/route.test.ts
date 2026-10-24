import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for POST /api/webhooks/messweg/[provider]: provider
 * lookup, missing configuration, the authenticity check before anything is
 * stored, ignored deliveries. ingestMesswegEvent is mocked (its DB behaviour
 * is covered by server/messweg/ingest.db.test.ts).
 */

const ingest = vi.fn(async (_e: unknown) => ({
  outcome: "angelegt",
  clinicId: "c1",
  requestId: "r1",
  replay: false,
}));
const writeAudit = vi.fn(async (..._a: unknown[]) => {});
const envMock: Record<string, string | undefined> = {
  MESSWEG_FIXTURE_SECRET: "fixture-secret-123",
  MATELSO_WEBHOOK_TOKEN: undefined,
  CALENDLY_WEBHOOK_SIGNING_KEY: "calendly-signing-key",
};

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
const rateLimit = vi.fn(async (..._a: unknown[]) => ({ ok: true, resetInSeconds: 60 }));
vi.mock("@/server/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
class MesswegBusyError extends Error {}
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("@/server/leads", () => ({ ClinicArchivedError: class extends Error {} }));
vi.mock("@/server/messweg/ingest", () => ({
  ingestMesswegEvent: (e: unknown) => ingest(e),
  MesswegBusyError,
}));

const { POST } = await import("./route.js");

function call(provider: string, raw: string, h: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/webhooks/messweg/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...h },
      body: raw,
    }) as never,
    { params: Promise.resolve({ provider }) }
  );
}

const fixtureRaw = JSON.stringify({
  kind: "anruf",
  externalId: "call-1",
  occurredAt: "2026-10-08T10:00:00Z",
  contactPhone: "+491712345678",
  calledNumber: "+4922112345678",
  durationSec: 30,
});
const sig = (raw: string) => createHmac("sha256", "fixture-secret-123").update(raw).digest("hex");

beforeEach(() => {
  ingest.mockClear();
  writeAudit.mockClear();
  rateLimit.mockClear();
});

describe("messweg webhook: rate limit and retries", () => {
  it("unsigned deliveries never touch the per-provider bucket", async () => {
    const res = await call("fixture", fixtureRaw, { "x-eins-signature": "00".repeat(32) });
    expect(res.status).toBe(401);
    expect(rateLimit.mock.calls.map((c) => c[0])).not.toContain("messweg-webhook");
  });

  it("an authentic delivery counts against the per-provider bucket", async () => {
    const res = await call("fixture", fixtureRaw, { "x-eins-signature": sig(fixtureRaw) });
    expect(res.status).toBe(200);
    expect(rateLimit.mock.calls.map((c) => c[0])).toContain("messweg-webhook");
  });

  it("answers 503 with Retry-After while the same delivery is in flight", async () => {
    ingest.mockRejectedValueOnce(new MesswegBusyError());
    const res = await call("fixture", fixtureRaw, { "x-eins-signature": sig(fixtureRaw) });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});

describe("POST /api/webhooks/messweg/[provider]", () => {
  it("404 for an unknown provider", async () => {
    expect((await call("doctolib", "{}")).status).toBe(404);
  });

  it("503 when the provider is not configured", async () => {
    expect((await call("matelso", "{}", { "x-eins-messweg-token": "x" })).status).toBe(503);
  });

  it("401 on a failed check, and nothing is ingested", async () => {
    const res = await call("fixture", fixtureRaw, { "x-eins-signature": "0".repeat(64) });
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("a signed test webhook is ingested as an anruf event and audited", async () => {
    const res = await call("fixture", fixtureRaw, { "x-eins-signature": sig(fixtureRaw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "angelegt" });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toMatchObject({ kind: "anruf", externalId: "call-1", calledNumber: "+4922112345678" });
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("200 without ingest for an authentic delivery EINS ignores", async () => {
    const raw = JSON.stringify({ event: "invitee.canceled", payload: {} });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", "calendly-signing-key").update(`${t}.${raw}`).digest("hex");
    const res = await call("calendly", raw, { "calendly-webhook-signature": `t=${t},v1=${v1}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "ignoriert" });
    expect(ingest).not.toHaveBeenCalled();
  });
});
