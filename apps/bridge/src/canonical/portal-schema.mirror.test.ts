import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Drift guard for the bridge-side mirror of the portal Zod schema
 * (portal-schema.ts). Compares every field-constraint LINE of the portal's
 * PvsEventSchema against the mirror, ignoring comments. Skipped when the portal
 * source is not checked out next to the bridge (e.g. a bridge-only Docker
 * context).
 */
const here = dirname(fileURLToPath(import.meta.url));
const PORTAL = join(here, "../../../portal/src/server/pvs-events.ts");
const MIRROR = readFileSync(join(here, "portal-schema.ts"), "utf8");

function constraintLines(src: string): string[] {
  const start = src.indexOf("const baseFields");
  const end = src.indexOf("export const PvsEventSchema");
  return src
    .slice(start, end)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z]+: z\./.test(l) || /^kind: z\.literal/.test(l))
    // clinicId is deliberately relaxed in the mirror.
    .filter((l) => !l.startsWith("clinicId:"))
    .filter((l) => !l.startsWith("bridgeSource:"));
}

describe.skipIf(!existsSync(PORTAL))("portal-schema mirror conformance", () => {
  it("every portal field constraint exists verbatim in the mirror", () => {
    const portal = readFileSync(PORTAL, "utf8");
    const mirror = new Set(constraintLines(MIRROR));
    const missing = constraintLines(portal).filter((l) => !mirror.has(l));
    expect(missing).toEqual([]);
  });

  it("and the mirror has no extra constraint lines", () => {
    const portal = new Set(constraintLines(readFileSync(PORTAL, "utf8")));
    const extra = constraintLines(MIRROR).filter((l) => !portal.has(l));
    expect(extra).toEqual([]);
  });
});
