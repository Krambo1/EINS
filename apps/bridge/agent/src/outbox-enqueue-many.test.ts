import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

let tempDir: string;

vi.mock("./config.js", () => ({
  outboxPath: () => join(tempDir, "outbox.sqlite"),
}));

let outbox: typeof import("./outbox");

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "eins-outbox-many-"));
  vi.resetModules();
  outbox = await import("./outbox.js");
  outbox.setOutboxKey("b".repeat(64));
});

afterEach(() => {
  outbox._closeForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("enqueueMany", () => {
  it("inserts all rows in one call and reports duplicates honestly", () => {
    outbox.enqueue('{"a":1}', "id-1");
    const res = outbox.enqueueMany([
      { payload: '{"a":1}', contentHash: "id-1" },
      { payload: '{"b":2}', contentHash: "id-2" },
      { payload: '{"b":2}', contentHash: "id-2" },
      { payload: '{"c":3}', contentHash: "id-3" },
    ]);
    expect(res).toEqual({ inserted: 2, duplicates: 2 });
    expect(outbox.dueRows(10).map((r) => r.contentHash).sort()).toEqual([
      "id-1",
      "id-2",
      "id-3",
    ]);
  });

  it("is a no-op for an empty list", () => {
    expect(outbox.enqueueMany([])).toEqual({ inserted: 0, duplicates: 0 });
  });

  it("handles thousands of rows quickly (single transaction)", () => {
    const items = Array.from({ length: 3000 }, (_, i) => ({
      payload: JSON.stringify({ i }),
      contentHash: `csv:${i}`,
    }));
    const t0 = Date.now();
    expect(outbox.enqueueMany(items).inserted).toBe(3000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
