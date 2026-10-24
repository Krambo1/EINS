import { describe, expect, it, vi } from "vitest";
import { FirebirdDriver } from "./firebird.js";

/** Finding 3: node-firebird hands BLOB SUB_TYPE TEXT columns back as lazy
 *  functions unless the attach option blobAsText is set. */

const h = vi.hoisted(() => ({ attachOptions: [] as Array<Record<string, unknown>> }));

vi.mock("node-firebird", () => {
  const attach = (
    options: Record<string, unknown>,
    cb: (err: Error | null, db: unknown) => void
  ): void => {
    h.attachOptions.push(options);
    cb(null, {
      on() {},
      detach() {},
      transaction() {},
      query() {},
    });
  };
  return { default: { attach }, attach };
});

describe("firebird driver: BLOB SUB_TYPE TEXT (finding 3)", () => {
  it("attaches with blobAsText so text blobs arrive as strings, not lazy functions", async () => {
    h.attachOptions.length = 0;
    const d = new FirebirdDriver();
    await d.connect({ host: "h", port: 3050, database: "db", username: "u", password: "p" });
    expect(h.attachOptions).toHaveLength(1);
    expect(h.attachOptions[0].blobAsText).toBe(true);
  });
});
