import { beforeEach, describe, expect, it, vi } from "vitest";

let link: { clinicId: string; vendor: string } | null;
let sources: Array<{ bridgeSource: string }>;
let updates: unknown[];
let inserts: unknown[];

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: (t: { __tag?: string }) => ({
        where: () => ({
          limit: async () =>
            t.__tag === "pvs_link" ? (link ? [link] : []) : sources,
        }),
      }),
    }),
    update: () => ({
      set: (v: unknown) => {
        updates.push(v);
        return { where: () => ({ returning: async () => [{ id: "h-1" }] }) };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v);
        return {
          onConflictDoNothing: () => ({ returning: async () => [{ id: "h-new" }] }),
        };
      },
    }),
  },
  schema: {
    pvsLink: { __tag: "pvs_link", clinicId: {}, pvsVendor: {} },
    pvsLinkSource: { __tag: "pvs_link_source", clinicId: {}, bridgeSource: {} },
    pvsLinkHealth: {
      clinicId: {},
      pvsVendor: {},
      streamKind: {},
      eventKind: {},
      resolvedAt: {},
      id: {},
      detectedAt: {},
    },
  },
}));

import { applyPvsHealth, PvsHealthEventSchema } from "./pvs-health";

const CLINIC = "11111111-2222-3333-4444-555555555555";
function ev(over: Record<string, unknown>) {
  return PvsHealthEventSchema.parse({
    clinicId: CLINIC,
    pvsVendor: "medatixx",
    bridgeSource: "medatixx",
    streamKind: "InvoicePaid",
    eventKind: "schema_drift",
    message: "m",
    detectedAt: "2026-05-21T10:00:00.000Z",
    ...over,
  });
}

beforeEach(() => {
  link = { clinicId: CLINIC, vendor: "gdt_agent" };
  sources = [];
  updates = [];
  inserts = [];
});

describe("applyPvsHealth vendor membership", () => {
  it("rejects a DB-adapter health event from an agent clinic that never enrolled the source", async () => {
    expect(await applyPvsHealth(ev({}))).toEqual({
      ok: false,
      reason: "vendor_mismatch",
    });
  });

  it("accepts it once the source is registered in pvs_link_source", async () => {
    sources = [{ bridgeSource: "medatixx" }];
    expect(await applyPvsHealth(ev({}))).toMatchObject({
      ok: true,
      status: "inserted",
    });
    expect(inserts).toHaveLength(1);
  });
});

describe("applyPvsHealth recoveries", () => {
  beforeEach(() => {
    sources = [{ bridgeSource: "medatixx" }];
  });

  it.each([
    "auth_recovered",
    "connection_recovered",
    "rate_limit_recovered",
    "config_recovered",
    "stream_recovered",
    "schema_recovered",
  ])("%s resolves open failures and inserts nothing", async (kind) => {
    const res = await applyPvsHealth(ev({ eventKind: kind }));
    expect(res).toMatchObject({ ok: true, status: "resolved", id: "h-1" });
    expect(updates).toHaveLength(1);
    expect(inserts).toHaveLength(0);
  });
});
