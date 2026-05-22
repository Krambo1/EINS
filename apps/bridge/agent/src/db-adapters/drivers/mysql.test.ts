import { describe, expect, it } from "vitest";
import { MysqlDriver } from "./mysql.js";

describe("mysql driver: surface contract", () => {
  it("declares engine='mysql' for the runner factory", () => {
    const d = new MysqlDriver();
    expect(d.engine).toBe("mysql");
  });

  it("healthCheck on unconfigured driver returns ok:false with a clean reason", async () => {
    const d = new MysqlDriver();
    const h = await d.healthCheck();
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe("not configured");
  });

  it("close() is safe to call on an unconnected driver", async () => {
    const d = new MysqlDriver();
    await expect(d.close()).resolves.toBeUndefined();
  });
});
