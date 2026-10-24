import { describe, it, expect, beforeEach } from "vitest";
import { computeHealth, markTickOk, _resetHealth } from "./health.js";

const TICK = 30_000;
const ok = async () => true;

describe("computeHealth", () => {
  beforeEach(() => _resetHealth(1_000_000));

  it("200 while ticks are fresh and the DB answers", async () => {
    markTickOk(1_000_000);
    const r = await computeHealth({ tickMs: TICK, now: 1_000_000 + TICK, ping: ok });
    expect(r.status).toBe(200);
  });

  it("503 after 3 tick intervals without a successful tick", async () => {
    markTickOk(1_000_000);
    const r = await computeHealth({ tickMs: TICK, now: 1_000_000 + TICK * 3 + 1, ping: ok });
    expect(r.status).toBe(503);
    expect((r.body.scheduler as { ok: boolean }).ok).toBe(false);
  });

  it("503 when the DB ping fails even if ticks are fresh", async () => {
    markTickOk(1_000_000);
    const r = await computeHealth({ tickMs: TICK, now: 1_000_000, ping: async () => false });
    expect(r.status).toBe(503);
    expect(r.body.db).toBe(false);
  });

  it("failing-link summary is informational: a throwing summary does not flip health", async () => {
    markTickOk(1_000_000);
    const r = await computeHealth({
      tickMs: TICK,
      now: 1_000_000,
      ping: ok,
      failingSummary: async () => {
        throw new Error("x");
      },
    });
    expect(r.status).toBe(200);
  });
});
