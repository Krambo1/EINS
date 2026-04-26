/**
 * Dev-time env loader for standalone tsx scripts (migrate, seed, worker).
 *
 * Next.js picks up `.env.local` automatically; plain node/tsx does not.
 * We load `.env.local` first (so dev overrides win), then `.env` for any
 * defaults that weren't overridden. Production should set env vars via
 * the process manager — neither file is expected to exist there.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
for (const file of [".env.local", ".env"]) {
  const p = path.join(cwd, file);
  if (existsSync(p)) config({ path: p, override: false });
}
