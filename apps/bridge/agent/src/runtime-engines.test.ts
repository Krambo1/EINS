import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pass 2: the installer ships Node 20 (bundle.mjs SHIP_NODE_MAJOR), but
 * undici 8.x declares engines.node >= 22.19 and crashed every agent mode at
 * startup. Nothing checked a runtime dependency's `engines` against the Node
 * the Praxis PC actually runs, so this pins it: every direct runtime
 * dependency must accept the shipped floor declared in our own `engines`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const agentRoot = join(here, "..");
const pkg = JSON.parse(readFileSync(join(agentRoot, "package.json"), "utf8")) as {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
};

type V = [number, number, number];

function parseVersion(s: string): V | null {
  const m = /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(s.trim());
  if (!m) return null;
  const n = (p: string | undefined) => (p === undefined || p === "x" || p === "*" ? 0 : Number(p));
  return [n(m[1]), n(m[2]), n(m[3])];
}

function cmp(a: V, b: V): number {
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  return 0;
}

/** Minimal semver `satisfies` for the range forms that appear in `engines`
 *  fields: `||` alternatives of space-separated comparators (>=, >, <=, <,
 *  =, ^, ~, bare/x-range) and hyphen ranges. Unknown syntax fails closed. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split("||").some((alt) => {
    const set = alt.trim();
    if (set === "" || set === "*") return true;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) {
      const lo = parseVersion(hyphen[1]!);
      const hi = parseVersion(hyphen[2]!);
      return !!lo && !!hi && cmp(v, lo) >= 0 && cmp(v, hi) <= 0;
    }
    return set
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
      .split(/\s+/)
      .every((c) => {
        const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(c);
        if (!m) return false;
        const op = m[1] ?? "";
        const t = parseVersion(m[2]!);
        if (!t) return false;
        const parts = m[2]!.split(".").filter((p) => p !== "x" && p !== "*").length;
        switch (op) {
          case ">=": return cmp(v, t) >= 0;
          case ">": return cmp(v, t) > 0;
          case "<=": return cmp(v, t) <= 0;
          case "<": return cmp(v, t) < 0;
          case "^": {
            const upper: V = t[0] > 0 ? [t[0] + 1, 0, 0] : t[1] > 0 ? [0, t[1] + 1, 0] : [0, 0, t[2] + 1];
            return cmp(v, t) >= 0 && cmp(v, upper) < 0;
          }
          case "~": {
            const upper: V = parts >= 2 ? [t[0], t[1] + 1, 0] : [t[0] + 1, 0, 0];
            return cmp(v, t) >= 0 && cmp(v, upper) < 0;
          }
          default: {
            // bare version or x-range: match the given parts only
            if (parts >= 3) return cmp(v, t) === 0;
            if (parts === 2) return v[0] === t[0] && v[1] === t[1];
            return v[0] === t[0];
          }
        }
      });
  });
}

describe("runtime dependency engines vs shipped Node (pass 2)", () => {
  const shippedFloor = pkg.engines?.node?.replace(/^>=\s*/, "") ?? "";

  it("the agent declares the shipped Node floor", () => {
    expect(shippedFloor).toMatch(/^20\.\d+\.\d+$/);
  });

  it("satisfies() handles the common engines forms", () => {
    expect(satisfies("20.18.0", ">=18.17")).toBe(true);
    expect(satisfies("20.18.0", ">=22.19.0")).toBe(false);
    expect(satisfies("20.18.0", "^20.17.0 || >=22.9.0")).toBe(true);
    expect(satisfies("20.18.0", "20 || 22 || >=24")).toBe(true);
    expect(satisfies("20.18.0", ">= 14")).toBe(true);
    expect(satisfies("20.18.0", ">=14.0.0 <20")).toBe(false);
    expect(satisfies("20.18.0", "18.x || 20.x")).toBe(true);
  });

  for (const name of Object.keys(pkg.dependencies ?? {})) {
    it(`${name} accepts Node ${shippedFloor}`, () => {
      // Read the manifest directly: some packages (chokidar 4) do not export
      // ./package.json, so require.resolve of it throws.
      const depPkgPath = join(agentRoot, "node_modules", name, "package.json");
      const dep = JSON.parse(readFileSync(depPkgPath, "utf8")) as {
        version: string;
        engines?: { node?: string };
      };
      const range = dep.engines?.node;
      if (!range) return; // no constraint declared
      expect(
        satisfies(shippedFloor, range),
        `${name}@${dep.version} requires node ${range}; the bundle ships ${shippedFloor}`
      ).toBe(true);
    });
  }
});
