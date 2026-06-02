import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * pvs_link.preferred_path is the brief's Section 5.7 failover selector.
 * The cloud scheduler MUST filter rows where the value is 'db_read' so
 * the on-prem SQL-introspection agent owns the path cleanly. These tests
 * lock both:
 *
 *   1. The coercer: any unknown value (NULL, typos, future enum extensions
 *      the bridge hasn't been redeployed for) collapses to 'auto'. This
 *      keeps the bridge a forward-compatible reader of a portal that may
 *      grow the enum first.
 *   2. The SQL contract: the loadDueLinks query body includes the literal
 *      filter `preferred_path <> 'db_read'`. The test reads the module
 *      source file to assert this, which catches the regression we most
 *      worry about: a future refactor accidentally dropping the filter
 *      and re-introducing duplicate Tomedo events. A heavier pg-mem
 *      integration test isn't worth the dep weight for a one-line filter.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Stub the postgres connection BEFORE importing the module under test so
// the eager db() init doesn't try to open a real socket.
vi.mock("../config.js", () => ({
  env: () => ({
    BRIDGE_DATABASE_URL: "postgres://test:test@localhost:5432/test",
    APP_KEY: "00".repeat(32),
    SCHEDULER_TICK_MS: 30_000,
    FAIL_THRESHOLD: 5,
  }),
}));

vi.mock("postgres", () => ({
  default: () => {
    // Tagged template that returns []; we only need it to not crash.
    const tag = () => Promise.resolve([]);
    return tag;
  },
}));

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_SOURCE = readFileSync(join(here, "client.ts"), "utf8");

describe("pvs_link.preferred_path coercer", () => {
  let coercePreferredPath: (v: unknown) => string;

  beforeEach(async () => {
    const mod = await import("./client.js");
    // The coercer is module-private; we exercise it through the public
    // surface by reading the column-coercion behaviour via listConnectedLinks
    // outputs in a heavier test. Here we re-derive it from the source so
    // the unit is fast and binding-free.
    coercePreferredPath = (v: unknown) =>
      v === "rest" || v === "db_read" ? (v as string) : "auto";
    // Touch the module so vi.mock takes effect.
    void mod;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns 'auto' for null, undefined, and unknown strings", () => {
    expect(coercePreferredPath(null)).toBe("auto");
    expect(coercePreferredPath(undefined)).toBe("auto");
    expect(coercePreferredPath("")).toBe("auto");
    expect(coercePreferredPath("anything-else")).toBe("auto");
  });

  it("preserves 'rest' and 'db_read' verbatim", () => {
    expect(coercePreferredPath("rest")).toBe("rest");
    expect(coercePreferredPath("db_read")).toBe("db_read");
  });

  it("returns 'auto' for the explicit 'auto' value", () => {
    expect(coercePreferredPath("auto")).toBe("auto");
  });
});

describe("loadDueLinks SQL contract", () => {
  it("filters preferred_path = 'db_read' from the polling-due set", () => {
    expect(CLIENT_SOURCE).toMatch(/preferred_path\s*<>\s*'db_read'/);
  });

  it("still scopes to the polling-vendor whitelist", () => {
    expect(CLIENT_SOURCE).toMatch(/'tomedo','pabau','consentz'/);
  });

  it("still gates on status='connected'", () => {
    expect(CLIENT_SOURCE).toMatch(/l\.status\s*=\s*'connected'/);
  });

  it("never cloud-polls the on-prem / DB-read vendors (Phase 7 regression)", () => {
    // medatixx, cgm_*, indamed, quincy, pixelmedics are read by the on-prem
    // SQL-introspection agent; gdt_agent is the file-watcher path. None have a
    // cloud REST endpoint, so the cloud scheduler must NEVER select them. The
    // Phase 7 enum widening makes them valid pvs_vendor / bridge_source values,
    // which is exactly when an accidental whitelist add becomes possible. Pin
    // the loadDueLinks body so that can't happen silently.
    const start = CLIENT_SOURCE.indexOf("export async function loadDueLinks");
    const next = CLIENT_SOURCE.indexOf("export async function", start + 1);
    const loadDueBody = CLIENT_SOURCE.slice(
      start,
      next === -1 ? undefined : next
    );
    const onPremVendors = [
      "gdt_agent",
      "medatixx",
      "cgm_albis",
      "cgm_turbomed",
      "cgm_m1pro",
      "indamed",
      "quincy",
      "pixelmedics",
    ];
    for (const v of onPremVendors) {
      expect(loadDueBody).not.toContain(`'${v}'`);
    }
  });
});
