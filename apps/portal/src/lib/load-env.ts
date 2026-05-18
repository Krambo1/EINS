/**
 * Dev-time env loader for standalone tsx scripts (migrate, seed, worker).
 *
 * Next.js picks up `.env.local` automatically; plain node/tsx does not.
 * We load `.env.local` first (so dev overrides win), then `.env` for any
 * defaults that weren't overridden. Production should set env vars via
 * the process manager — neither file is expected to exist there.
 *
 * `dotenv` is a devDependency, so it's absent from the worker's
 * production image (built via `pnpm deploy --prod`). The dynamic import
 * lets the file no-op gracefully there instead of crashing at boot.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const cwd = process.cwd();
const candidates = [".env.local", ".env"]
  .map((f) => path.join(cwd, f))
  .filter((p) => existsSync(p));

if (candidates.length > 0) {
  try {
    const localRequire = createRequire(import.meta.url);
    const { config } = localRequire("dotenv") as typeof import("dotenv");
    for (const p of candidates) config({ path: p, override: false });
  } catch {
    // dotenv isn't installed — production image path. Env vars are
    // expected to be set by the orchestrator (Docker --env-file, k8s
    // Secret, Vercel, etc.).
  }
}
