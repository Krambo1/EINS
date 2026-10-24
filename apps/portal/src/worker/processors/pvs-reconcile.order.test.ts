import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Pass 2 (verifier): after migration 0091 every PVS patient has
 * pvs_derived_at NULL and needs one re-derive (500 per run). The stale query
 * ordered NULLS LAST, so patients that were never derived (all the pass-2
 * attribution) waited behind every stamped one; a large Praxis waited days.
 * Live updates are derived at apply time anyway; reconcile is the catch-up.
 */
const captured: SQL[] = [];
vi.mock("@/db/client", () => ({
  db: {
    execute: async (q: SQL) => {
      captured.push(q);
      throw new Error("stop-after-first-query");
    },
  },
  schema: {},
}));
vi.mock("@/server/jobs", () => ({ enqueuePvsStatusDerive: async () => {} }));
vi.mock("@/server/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/server/ops-alerts", () => ({ notifyOps: async () => {} }));

import { processPvsReconcile } from "./pvs-reconcile";

describe("pvs-reconcile stale re-derive order", () => {
  it("never-derived patients (pvs_derived_at NULL) come first", async () => {
    await expect(processPvsReconcile()).rejects.toThrow("stop-after-first-query");
    const text = new PgDialect().sqlToQuery(captured[0]!).sql;
    expect(text).toContain("ORDER BY p.pvs_derived_at ASC NULLS FIRST");
  });
});
