import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeAudit, chunks } = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  chunks: { fn: (async function* () {}) as (id: string) => AsyncGenerator<{ table: string; rows: unknown[] }> },
}));

vi.mock("@/auth/admin-guards", () => ({
  requireAdminForApi: async () => ({ ok: true, admin: { email: "admin@example.test" } }),
}));
vi.mock("@/db/client", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ slug: "praxis-test" }] };
  return { db: { select: () => chain }, schema: { clinics: { slug: "slug", id: "id" } } };
});
vi.mock("@/server/dsgvo", () => ({ exportClinicDataChunks: (id: string) => chunks.fn(id) }));
vi.mock("@/server/audit", () => ({ writeAudit }));

const { GET } = await import("./route");

const ID = "11111111-1111-4111-8111-111111111111";
const call = () =>
  GET(new Request("http://x/api/admin/clinics/x/dsgvo/export") as never, {
    params: Promise.resolve({ id: ID }),
  });
const statuses = () => writeAudit.mock.calls.map((c) => (c[0] as { diff: { status: string } }).diff.status);

beforeEach(() => {
  writeAudit.mockReset().mockResolvedValue(undefined);
});

describe("DSGVO export audit (V1 Neben)", () => {
  it("full download: valid JSON, audit complete only at the end", async () => {
    chunks.fn = async function* () {
      yield { table: "requests", rows: [] };
      yield { table: "requests", rows: [{ id: 1 }, { id: 2 }] };
      yield { table: "requests", rows: [{ id: 3 }] };
      yield { table: "treatments", rows: [{ id: "t" }] };
    };
    const res = await call();
    expect(writeAudit).not.toHaveBeenCalled();
    const doc = JSON.parse(await res.text());
    expect(doc.tables).toEqual({ requests: [{ id: 1 }, { id: 2 }, { id: 3 }], treatments: [{ id: "t" }] });
    expect(statuses()).toEqual(["complete"]);
    expect((writeAudit.mock.calls[0]![0] as { diff: { rows: number } }).diff.rows).toBe(4);
  });

  it("aborted download: no complete, audit aborted", async () => {
    chunks.fn = async function* () {
      yield { table: "requests", rows: [{ id: 1 }] };
      yield { table: "requests", rows: [{ id: 2 }] };
      yield { table: "requests", rows: [{ id: 3 }] };
    };
    const res = await call();
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(statuses()).toEqual(["aborted"]);
  });

  it("query error mid-stream: audit failed, never complete", async () => {
    chunks.fn = async function* () {
      yield { table: "requests", rows: [{ id: 1 }] };
      throw new Error("db gone");
    };
    const res = await call();
    await expect(res.text()).rejects.toThrow();
    expect(statuses()).toEqual(["failed"]);
  });
});
