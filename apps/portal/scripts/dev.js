#!/usr/bin/env node
/**
 * Wraps `next dev` so we can inject an extra "Admin: …" line right under
 * Next's "Local:" line in the startup banner. The Admin host is what we
 * actually log into for /admin, so making it clickable saves a copy-paste.
 *
 * Also spawns the BullMQ worker alongside Next so a single `pnpm dev`
 * (root or portal) boots the full local stack. Worker output is prefixed
 * with `[worker]` so it's distinguishable in the interleaved stream.
 * Set DISABLE_WORKER=1 to skip it (e.g. when running the worker yourself
 * in another terminal for focused debugging).
 *
 * Node-version pin: see scripts/find-node20.cjs at the repo root — newer
 * Node (22+) ships an undici with tighter headers timeouts that makes
 * Next's "forward action response" fetch spam UND_ERR_HEADERS_TIMEOUT.
 */
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const path = require("node:path");
const { pinNode20IntoEnv } = require(path.join(__dirname, "..", "..", "..", "scripts", "find-node20.cjs"));

// Port + worker are parameterizable so several Claude Code sessions can each
// preview the portal at once. The Claude preview registry is shared across
// sessions and reuses servers by NAME, so each session points at a distinct
// config (.claude/launch.json: portal / portal-b / portal-c), which boots a
// fresh process on its own port. Pass `--port=` (and `--no-worker` for the
// extras) after a `--` separator; PORT env is also honored. Default 3001 keeps
// the normal single-instance `pnpm dev` case unchanged.
const cliArgs = process.argv.slice(2);
const portArg = cliArgs.find((a) => a.startsWith("--port="));
const port = portArg ? portArg.slice("--port=".length) : process.env.PORT || "3001";
const noWorker = cliArgs.includes("--no-worker");

const childEnv = pinNode20IntoEnv({ ...process.env, FORCE_COLOR: "1" }, "[dev]");

// Each parallel `next dev` needs its own build dir, otherwise concurrent
// instances clobber a shared .next cache (HMR corruption, lock contention).
// The default port keeps `.next` so the normal single-instance case and any
// existing tooling are unchanged. next.config.ts reads NEXT_DIST_DIR.
if (port !== "3001") childEnv.NEXT_DIST_DIR = `.next-${port}`;

// `--turbopack` is a 5–10× win for first-nav-per-route compile in this app
// (the dependency graph here — recharts, radix × 13, lazy AWS SDK, drizzle
// — makes webpack's first-touch compile of an unvisited route 3–10s; Turbo
// reduces it to sub-second). Set DISABLE_TURBOPACK=1 to fall back if Turbo
// ever breaks on a dependency upgrade.
const useTurbo = process.env.DISABLE_TURBOPACK !== "1";
const nextArgs = ["dev", "-p", port];
if (useTurbo) nextArgs.push("--turbopack");

const nextChild = spawn("next", nextArgs, {
  stdio: ["inherit", "pipe", "inherit"],
  shell: true,
  env: childEnv,
});

const nextOut = readline.createInterface({ input: nextChild.stdout });
nextOut.on("line", (line) => {
  process.stdout.write(line + "\n");
  if (line.includes("- Local:")) {
    process.stdout.write(`   - Admin:        http://admin.localhost:${port}\n`);
  }
});

const workerEnabled = process.env.DISABLE_WORKER !== "1" && !noWorker;
const workerChild = workerEnabled
  ? spawn("pnpm", ["worker"], {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
      env: childEnv,
    })
  : null;

if (workerChild) {
  const prefix = (stream, label) => {
    const rl = readline.createInterface({ input: stream });
    rl.on("line", (line) => process.stdout.write(`[${label}] ${line}\n`));
  };
  prefix(workerChild.stdout, "worker");
  prefix(workerChild.stderr, "worker");
}

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  nextChild.kill(signal);
  if (workerChild) workerChild.kill(signal);
};

// If either child exits, tear down the other so we never leave half a stack
// running. Exit with the first non-zero code we see, otherwise 0.
let exitCode = null;
const onChildExit = (name) => (code) => {
  if (exitCode === null) exitCode = code ?? 1;
  if (!shuttingDown) {
    process.stdout.write(`[dev] ${name} exited (${code}); shutting down\n`);
    shutdown("SIGTERM");
  }
  // Wait for the other child to finish too before exiting the parent.
  if (
    (name === "next" && (!workerChild || workerChild.exitCode !== null)) ||
    (name === "worker" && nextChild.exitCode !== null)
  ) {
    process.exit(exitCode);
  }
};

nextChild.on("exit", onChildExit("next"));
if (workerChild) workerChild.on("exit", onChildExit("worker"));

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
