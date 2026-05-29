#!/usr/bin/env node
/**
 * Root `pnpm dev` wrapper. Pins pnpm itself to Node 20 before it iterates
 * the workspace, so the per-app `engines.node: 20.x` constraint matches
 * the running Node and pnpm doesn't print "Unsupported engine" WARNs.
 *
 * The per-app dev wrappers (apps/portal, apps/bridge) re-pin Node 20 for
 * their children too — once we're already on 20 here that's a no-op.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pinNode20IntoEnv } = require(path.join(__dirname, "find-node20.cjs"));

const childEnv = pinNode20IntoEnv({ ...process.env, FORCE_COLOR: "1" }, "[root dev]");

const child = spawn("pnpm", ["--parallel", "--filter", "./apps/*", "dev"], {
  stdio: "inherit",
  shell: true,
  env: childEnv,
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill(signal);
};

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
