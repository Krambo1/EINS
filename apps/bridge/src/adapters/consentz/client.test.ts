import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConsentzClient } from "./client.js";
import type { PvsLinkRow } from "../../db/client.js";

const CLINIC = "00000000-0000-0000-0000-000000000002";

function link(extra: Record<string, unknown> = {}): PvsLinkRow {
  return {
    id: "link-2",
    clinicId: CLINIC,
    pvsVendor: "consentz",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: {
      consentzEndpoint: "https://praxis-x.consentz.io/api",
      consentzApiToken: "tok-xyz",
      consentzTenantId: "tenant-7",
      ...extra,
    },
  };
}

function mockResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("ConsentzClient.from", () => {
  it("throws when endpoint or token missing", () => {
    expect(() =>
      ConsentzClient.from({
        id: "x",
        clinicId: CLINIC,
        pvsVendor: "consentz",
        status: "connected",
        preferredPath: "auto",
        connectionConfig: { consentzApiToken: "tok" },
      })
    ).toThrow(/missing/);
    expect(() =>
      ConsentzClient.from({
        id: "x",
        clinicId: CLINIC,
        pvsVendor: "consentz",
        status: "connected",
        preferredPath: "auto",
        connectionConfig: { consentzEndpoint: "https://x" },
      })
    ).toThrow(/missing/);
  });
});

describe("ConsentzClient: requests", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("sends Bearer token + X-Tenant-Id header on every page", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: "c-1", updated_at: "2026-05-21T00:00:00.000Z" }] })
      )
      .mockResolvedValueOnce(mockResponse({ data: [] }));
    const client = ConsentzClient.from(link());
    for await (const _p of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      void _p;
    }
    const call = fetchSpy.mock.calls[0]!;
    const headers = (call[1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer tok-xyz");
    expect(headers["x-tenant-id"]).toBe("tenant-7");
    const url = call[0] as string;
    expect(url).toContain("/clients");
    expect(url).toContain("updated_since=");
  });

  it("paginates until an EMPTY page (H17)", async () => {
    // H17: stop on an empty page, not a short one, so a server-side page-size
    // clamp cannot drop rows after the first short page.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `c-${i + 1}`,
      updated_at: "2026-05-21T00:00:00.000Z",
    }));
    fetchSpy
      .mockResolvedValueOnce(mockResponse({ data: fullPage }))
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: "c-101", updated_at: "2026-05-21T00:00:00.000Z" }] })
      )
      .mockResolvedValueOnce(mockResponse({ data: [] }));
    const client = ConsentzClient.from(link());
    const seen: unknown[] = [];
    for await (const p of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      seen.push(p);
    }
    expect(seen).toHaveLength(101);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("throws on a 200 whose body has neither a data nor items array (M-S2)", async () => {
    // A 200 error envelope must NOT be read as a healthy empty page (that would
    // silently mark the stream permanently drained at first onboarding).
    fetchSpy.mockResolvedValueOnce(mockResponse({ error: "bad_tenant" }));
    const client = ConsentzClient.from(link());
    await expect(async () => {
      for await (const _p of client.streamPatients(
        "1970-01-01T00:00:00.000Z"
      )) {
        void _p;
      }
    }).rejects.toThrow(/missing 'data'\/'items' array/);
  });

  it("retries on 429 with Retry-After", async () => {
    const sleepSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((cb: (...args: unknown[]) => void) => {
        if (typeof cb === "function") cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout);

    fetchSpy
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "1" } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: "c-1", updated_at: "2026-05-21T00:00:00.000Z" }] })
      )
      .mockResolvedValueOnce(mockResponse({ data: [] }));

    const client = ConsentzClient.from(link());
    let count = 0;
    for await (const _p of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      count += 1;
      void _p;
    }
    expect(count).toBe(1);
    sleepSpy.mockRestore();
  });
});

describe("ConsentzClient.healthCheck", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("uses /health when available", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ status: "ok" }));
    const client = ConsentzClient.from(link());
    await expect(client.healthCheck()).resolves.toBeUndefined();
    expect((fetchSpy.mock.calls[0]![0] as string).endsWith("/health")).toBe(true);
  });

  it("falls through /health → /me → /clients", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(mockResponse({ data: [] }));
    const client = ConsentzClient.from(link());
    await expect(client.healthCheck()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("throws when all three probes fail", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const client = ConsentzClient.from(link());
    await expect(client.healthCheck()).rejects.toThrow(/404\/403\/500/);
  });
});
