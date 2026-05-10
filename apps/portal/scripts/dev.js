#!/usr/bin/env node
/**
 * Wraps `next dev` so we can inject an extra "Admin: …" line right under
 * Next's "Local:" line in the startup banner. The Admin host is what we
 * actually log into for /admin, so making it clickable saves a copy-paste.
 */
const { spawn } = require("node:child_process");
const readline = require("node:readline");

// `--turbopack` is a 5–10× win for first-nav-per-route compile in this app
// (the dependency graph here — recharts, radix × 13, lazy AWS SDK, drizzle
// — makes webpack's first-touch compile of an unvisited route 3–10s; Turbo
// reduces it to sub-second). Set DISABLE_TURBOPACK=1 to fall back if Turbo
// ever breaks on a dependency upgrade.
const useTurbo = process.env.DISABLE_TURBOPACK !== "1";
const args = ["dev", "-p", "3001"];
if (useTurbo) args.push("--turbopack");

const child = spawn("next", args, {
  stdio: ["inherit", "pipe", "inherit"],
  shell: true,
  env: { ...process.env, FORCE_COLOR: "1" },
});

const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  process.stdout.write(line + "\n");
  if (line.includes("- Local:")) {
    process.stdout.write("   - Admin:        http://admin.localhost:3001\n");
  }
});

child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
