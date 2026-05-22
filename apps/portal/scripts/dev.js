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
 * Node-version pin: Vercel runs Node 20. Newer Node (22+) ships an undici
 * with tighter headers timeouts that makes Next's internal "forward action
 * response" fetch spam `UND_ERR_HEADERS_TIMEOUT` in dev. If the parent
 * Node is >20 we look for a Node 20 binary on disk (scoop / nvm-windows /
 * fnm / volta / Program Files) and prepend its directory to PATH for the
 * child processes, so `next` and `tsx` resolve to Node 20 even when the
 * user's default `node` is newer.
 */
const { spawn, execFileSync } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

function verifyNode20(binary) {
  try {
    const out = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
    return out.startsWith("v20.") ? binary : null;
  } catch {
    return null;
  }
}

function findNode20() {
  const currentMajor = Number(process.versions.node.split(".")[0]);
  if (currentMajor === 20) return process.execPath;

  const exe = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [];
  const home = process.env.USERPROFILE || process.env.HOME;

  // scoop (Windows) — what Karam has installed
  if (home) {
    candidates.push(path.join(home, "scoop", "apps", "nodejs20", "current", exe));
    candidates.push(path.join(home, "scoop", "apps", "nodejs", "current", exe));
  }

  // nvm-windows
  const nvmHome = process.env.NVM_HOME;
  if (nvmHome) {
    try {
      for (const d of fs.readdirSync(nvmHome)) {
        if (d.startsWith("v20.")) candidates.push(path.join(nvmHome, d, exe));
      }
    } catch {}
  }

  // nvm (unix)
  if (home) {
    const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
    try {
      const root = path.join(nvmDir, "versions", "node");
      for (const d of fs.readdirSync(root)) {
        if (d.startsWith("v20.")) candidates.push(path.join(root, d, "bin", exe));
      }
    } catch {}
  }

  // fnm
  const fnmDir = process.env.FNM_DIR || (home && path.join(home, ".fnm"));
  if (fnmDir) {
    try {
      const root = path.join(fnmDir, "node-versions");
      for (const d of fs.readdirSync(root)) {
        if (d.startsWith("v20.")) {
          candidates.push(path.join(root, d, "installation", exe));
          candidates.push(path.join(root, d, "installation", "bin", exe));
        }
      }
    } catch {}
  }

  // volta
  const voltaHome =
    process.env.VOLTA_HOME ||
    (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Volta")) ||
    (home && path.join(home, ".volta"));
  if (voltaHome) {
    try {
      const root = path.join(voltaHome, "tools", "image", "node");
      for (const d of fs.readdirSync(root)) {
        if (d.startsWith("20.")) {
          candidates.push(path.join(root, d, exe));
          candidates.push(path.join(root, d, "bin", exe));
        }
      }
    } catch {}
  }

  // system install
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\nodejs\\node.exe");
  } else {
    candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node");
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const ok = verifyNode20(c);
      if (ok) return ok;
    }
  }
  return null;
}

const currentMajor = Number(process.versions.node.split(".")[0]);
let childEnv = { ...process.env, FORCE_COLOR: "1" };

if (currentMajor !== 20) {
  const node20 = findNode20();
  if (node20) {
    const node20Dir = path.dirname(node20);
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const existing = childEnv[pathKey] || childEnv.PATH || childEnv.Path || "";
    childEnv[pathKey] = `${node20Dir}${path.delimiter}${existing}`;
    process.stdout.write(
      `[dev] parent Node is ${process.version}; pinning children to Node 20 at ${node20Dir}\n`,
    );
  } else {
    process.stdout.write(
      `[dev] WARN: running on ${process.version}, but project targets Node 20. ` +
        `Newer Node ships an undici with tighter timeouts that triggers ` +
        `"failed to forward action response / UND_ERR_HEADERS_TIMEOUT" spam in dev. ` +
        `Install Node 20 (e.g. \`scoop install nodejs20\`) to silence these.\n`,
    );
  }
}

// `--turbopack` is a 5–10× win for first-nav-per-route compile in this app
// (the dependency graph here — recharts, radix × 13, lazy AWS SDK, drizzle
// — makes webpack's first-touch compile of an unvisited route 3–10s; Turbo
// reduces it to sub-second). Set DISABLE_TURBOPACK=1 to fall back if Turbo
// ever breaks on a dependency upgrade.
const useTurbo = process.env.DISABLE_TURBOPACK !== "1";
const nextArgs = ["dev", "-p", "3001"];
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
    process.stdout.write("   - Admin:        http://admin.localhost:3001\n");
  }
});

const workerEnabled = process.env.DISABLE_WORKER !== "1";
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
