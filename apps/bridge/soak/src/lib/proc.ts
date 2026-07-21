import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createWriteStream, type WriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_DIR } from "./env.js";
import { ensureDir, log, ts } from "./util.js";

const require = createRequire(import.meta.url);

/**
 * Resolve the tsx CLI entry from the soak package's own node_modules and run
 * the agent source with plain `node <tsx-cli> <agent entry>`. This avoids
 * spawning pnpm.cmd / .bin shims (fragile on Windows without shell:true) and
 * still resolves the agent's own dependencies correctly, because Node module
 * resolution walks up from each imported file — i.e. from apps/bridge/agent.
 */
export function tsxCliPath(): string {
  const pkgJson = require.resolve("tsx/package.json");
  return join(dirname(pkgJson), "dist", "cli.mjs");
}

export interface AgentSpawnOpts {
  /** APPDATA override — isolates config/secret/outbox per clinic. */
  appdata: string;
  args: string[];
  logFile: string;
  /** Written to the child's stdin then closed (e.g. enrollment token). */
  stdinData?: string;
}

export function spawnAgentProcess(opts: AgentSpawnOpts): {
  child: ChildProcess;
  logStream: WriteStream;
} {
  ensureDir(dirname(opts.logFile));
  ensureDir(opts.appdata);
  const logStream = createWriteStream(opts.logFile, { flags: "a" });
  logStream.write(
    `\n----- ${ts()} spawn eins-agent ${opts.args.join(" ")} -----\n`
  );
  const child = spawn(
    process.execPath,
    [tsxCliPath(), join(AGENT_DIR, "src", "index.ts"), ...opts.args],
    {
      cwd: AGENT_DIR,
      env: { ...process.env, APPDATA: opts.appdata },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  child.stdout?.on("data", (d: Buffer) => logStream.write(d));
  child.stderr?.on("data", (d: Buffer) => logStream.write(d));
  if (opts.stdinData !== undefined) {
    child.stdin?.write(opts.stdinData);
  }
  child.stdin?.end();
  return { child, logStream };
}

/** Run a one-shot agent command (enroll etc.) and wait for exit. */
export function runAgentOnce(opts: AgentSpawnOpts): Promise<number> {
  return new Promise((resolve, reject) => {
    const { child, logStream } = spawnAgentProcess(opts);
    child.on("error", (err) => {
      logStream.end();
      reject(err);
    });
    child.on("close", (code) => {
      logStream.end();
      resolve(code ?? -1);
    });
  });
}

/**
 * Hard-kill a child incl. its process tree. The agent spawns powershell
 * children (DPAPI) — taskkill /T reaps those too. SIGKILL fallback elsewhere.
 */
export function killTree(child: ChildProcess, label: string): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  log("proc", `hard-killing ${label} (pid ${child.pid})`);
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    killer.on("error", () => child.kill("SIGKILL"));
  } else {
    child.kill("SIGKILL");
  }
}
