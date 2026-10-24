import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * B-27: the admin layout does not gate; every admin page, server action and
 * route handler must call an admin guard itself. This test turns that
 * convention into a check, so a new admin surface without a guard fails CI.
 *
 * Public on purpose (sign-in surfaces), listed by exact path so a new file
 * next to them is NOT exempt automatically.
 */
const ADMIN_DIR = fileURLToPath(new URL("../app/admin", import.meta.url));

const PUBLIC_FILES = new Set([
  "login/page.tsx",
  "login/link/page.tsx",
  "login/actions.ts",
  "login/callback/route.ts",
  "login/google/start/route.ts",
  "login/google/callback/route.ts",
  "logout/route.ts",
  "forgot-password/page.tsx",
  "set-password/page.tsx",
  "set-password/actions.ts",
]);

const GUARD_CALL = /\b(?:requireAdmin|requireAdminForApi|getAdminSession)\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ADMIN_DIR, file).split(path.sep).join("/");
}

const files = walk(ADMIN_DIR);
const pages = files.filter((f) => /[\\/]page\.tsx$/.test(f));
const routes = files.filter((f) => /[\\/]route\.ts$/.test(f));
const actionFiles = files.filter(
  (f) => /actions\.ts$/.test(f) && !/\.test\.ts$/.test(f) && readFileSync(f, "utf8").includes('"use server"')
);

/**
 * Split a server-action module into top-level function chunks. An exported
 * action passes when its own body calls a guard, or when it calls a local
 * helper whose body does (e.g. `record()` in rueckruf/actions.ts).
 */
function unguardedExports(source: string): string[] {
  const starts = [...source.matchAll(/^(export\s+)?(async\s+)?function\s+(\w+)/gm)];
  const chunks = starts.map((m, i) => ({
    exported: Boolean(m[1]),
    name: m[3]!,
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1]!.index : source.length),
  }));
  // Transitive: a helper is guarded when its body calls a guard or another
  // guarded local helper (garantie: action -> ...ActionRun -> sendDelayNotice).
  const calls = (body: string, name: string) => new RegExp(`\\b${name}\\s*\\(`).test(body);
  const guardedHelpers: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of chunks) {
      if (c.exported || guardedHelpers.includes(c.name)) continue;
      const body = c.body.replace(new RegExp(`^(async\\s+)?function\\s+${c.name}`), "");
      if (GUARD_CALL.test(c.body) || guardedHelpers.some((h) => calls(body, h))) {
        guardedHelpers.push(c.name);
        changed = true;
      }
    }
  }
  return chunks
    .filter((c) => c.exported)
    .filter(
      (c) =>
        !GUARD_CALL.test(c.body) &&
        !guardedHelpers.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(c.body))
    )
    .map((c) => c.name);
}

describe("admin guard coverage (B-27)", () => {
  it("finds the admin app", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it("every public exemption still exists (no stale allowlist)", () => {
    for (const f of PUBLIC_FILES) {
      expect(existsSync(path.join(ADMIN_DIR, f)), f).toBe(true);
    }
  });

  it("every admin page calls an admin guard", () => {
    const missing = pages
      .filter((f) => !PUBLIC_FILES.has(rel(f)))
      .filter((f) => !GUARD_CALL.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("every admin route handler calls an admin guard", () => {
    const missing = routes
      .filter((f) => !PUBLIC_FILES.has(rel(f)))
      .filter((f) => !GUARD_CALL.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("every exported admin server action calls an admin guard", () => {
    const missing = actionFiles
      .filter((f) => !PUBLIC_FILES.has(rel(f)))
      .flatMap((f) => unguardedExports(readFileSync(f, "utf8")).map((name) => `${rel(f)}#${name}`));
    expect(missing).toEqual([]);
  });

  it("the chunker flags an exported action without a guard", () => {
    const src = `"use server";
async function helper() { await requireAdmin(); }
export async function ok1() { await requireAdmin(); }
export async function ok2() { await helper(); }
export async function bad() { return 1; }
`;
    expect(unguardedExports(src)).toEqual(["bad"]);
  });
});
