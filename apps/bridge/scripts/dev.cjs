#!/usr/bin/env node
/**
 * Wraps `tsx watch src/index.ts` so the bridge runs on Node 20 in dev,
 * matching apps/portal and Vercel. See scripts/find-node20.cjs at the
 * repo root for the discovery logic shared with the portal.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pinNode20IntoEnv } = require(path.join(__dirname, "..", "..", "..", "scripts", "find-node20.cjs"));

const childEnv = pinNode20IntoEnv({ ...process.env, FORCE_COLOR: "1" }, "[bridge dev]");

const child = spawn("tsx", ["watch", "src/index.ts"], {
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
