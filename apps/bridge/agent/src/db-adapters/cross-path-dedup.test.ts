import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cross-path dedup contract (review finding 1).
 *
 * Tomedo can be fed two ways:
 *   • DB-read  — apps/bridge/agent/src/db-adapters/configs/tomedo.yaml
 *   • Lua hooks — apps/portal/public/pvs-bridge/tomedo-lua/hooks/*.lua
 *
 * The portal dedups REPLAYS within one path on the UNIQUE index
 *   (clinicId, bridge_source, pvs_external_event_id, occurred_at).
 *
 * It does NOT dedup ACROSS the two paths, because they emit different
 * pvs_external_event_id prefixes ("tomedo:" vs "tomedo-lua:") while sharing
 * the same bridge_source. So the same payment becomes two rows and is counted
 * twice — double revenue and double ad-conversion. The paths are a
 * fallback pair (DB-read = source of truth, Lua = liveness), NOT a
 * simultaneous redundant feed.
 *
 * This test LOCKS that divergence on purpose. If you intend to enable safe
 * simultaneous redundancy you must FIRST align the prefixes AND occurred_at so
 * the dedup index actually collapses the two paths, THEN update this test and
 * the READMEs deliberately. A silent prefix change that aligns one field but
 * not the others would create a subtle partial-dedup bug; this test is the
 * tripwire for that.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tomedoYaml = readFileSync(join(here, "configs", "tomedo.yaml"), "utf8");
// The Lua bundle ships from the portal's public assets. here =
// apps/bridge/agent/src/db-adapters → four levels up is apps/.
const luaInvoice = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "portal",
    "public",
    "pvs-bridge",
    "tomedo-lua",
    "hooks",
    "invoice_paid.lua"
  ),
  "utf8"
);

describe("cross-path dedup contract (review finding 1)", () => {
  it("DB-read and Lua emit DISTINCT invoice external-event-id prefixes", () => {
    // DB-read: "tomedo:invoice:{id}"
    expect(tomedoYaml).toMatch(
      /pvsExternalEventId:\s*\{\s*template:\s*"tomedo:invoice:\{id\}"/
    );
    // Lua: "tomedo-lua:invoice:" .. inv_id
    expect(luaInvoice).toMatch(/pvsExternalEventId\s*=\s*"tomedo-lua:invoice:"/);
  });

  it("but stamp the SAME bridge_source, so the dedup key collides on source and diverges on id", () => {
    // Both paths use bridge_source = "tomedo". Combined with the differing
    // pvs_external_event_id prefix above, the UNIQUE index treats one payment
    // as two distinct rows. THIS is why the two paths must not co-run.
    expect(tomedoYaml).toContain("bridgeSource: tomedo");
    expect(luaInvoice).toContain('bridgeSource       = "tomedo"');
  });
});
