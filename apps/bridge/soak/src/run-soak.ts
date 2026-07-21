import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  CLINIC_A,
  CLINIC_B,
  LOG_DIR,
  PORTAL_DB_URL,
  VENDOR_DB_URL,
  agentConfigDir,
} from "./lib/env.js";
import { query } from "./lib/pg.js";
import { fmtEur, log, sleep, sqlNumericToCents, warn } from "./lib/util.js";
import { killTree, spawnAgentProcess } from "./lib/proc.js";
import { startProxy, setProxyMode, getProxyMode, proxyAlreadyRunning, type ProxyHandle } from "./proxy.js";
import { startChurn, type ChurnHandle } from "./churn.js";
import { startDropper, type DropperHandle } from "./dropper.js";
import { startChaos, type ChaosHandle } from "./chaos.js";
import { reconcile } from "./reconcile.js";
import { writeDbCredential } from "./lib/agent-bridge.js";

/**
 * Soak orchestrator. Runs the REAL agent binaries (from source, same code)
 * against the simulated Praxis for a configurable duration, with churn +
 * file drops + chaos, then drains, reconciles, and writes the report.
 *
 *   pnpm --filter eins-bridge-soak smoke              # 8-minute proof run
 *   pnpm --filter eins-bridge-soak soak -- --hours 48 # the real thing
 *   pnpm --filter eins-bridge-soak soak -- --minutes 90 --no-chaos
 */

interface Args {
  durationMs: number;
  smoke: boolean;
  chaos: boolean;
  edge: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): number | null => {
    const i = argv.indexOf(flag);
    if (i < 0 || i + 1 >= argv.length) return null;
    const n = Number(argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const minutes = get("--minutes");
  const hours = get("--hours");
  const durationMs =
    minutes !== null ? minutes * 60_000 : hours !== null ? hours * 3_600_000 : 48 * 3_600_000;
  return {
    durationMs,
    smoke: argv.includes("--smoke"),
    chaos: !argv.includes("--no-chaos"),
    edge: argv.includes("--edge"),
  };
}

// ---------------------------------------------------------------------------

class AgentHandle {
  private child: ChildProcess | null = null;
  private intentionalKill = false;
  private stopped = false;
  restarts = 0;

  constructor(
    readonly which: "A" | "B",
    private readonly appdata: string,
    private readonly logFile: string
  ) {}

  start(): void {
    if (this.stopped) return;
    this.intentionalKill = false;
    const { child } = spawnAgentProcess({
      appdata: this.appdata,
      logFile: this.logFile,
      args: ["--allow-insecure-dev"],
    });
    this.child = child;
    log("agent", `agent ${this.which} started (pid ${child.pid})`);
    child.on("close", (code) => {
      if (this.stopped || this.intentionalKill) return;
      // Unexpected death (agent crash counts as a finding worth reading the
      // log for, but the soak keeps going like a Praxis workstation would:
      // the watchdog restarts it).
      warn("agent", `agent ${this.which} exited unexpectedly (code ${code}) — restarting in 5s. Check ${this.logFile}`);
      this.restarts++;
      setTimeout(() => this.start(), 5000);
    });
  }

  kill(): void {
    this.intentionalKill = true;
    if (this.child) killTree(this.child, `agent ${this.which}`);
  }

  restart(): void {
    if (this.alive()) this.kill();
    setTimeout(() => this.start(), 1500);
  }

  alive(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.intentionalKill;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.intentionalKill = true;
    if (this.child) killTree(this.child, `agent ${this.which}`);
    await sleep(1000);
  }
}

// ---------------------------------------------------------------------------

async function portalEventCounts(): Promise<{ a: number; b: number }> {
  try {
    const res = await query(
      PORTAL_DB_URL,
      `SELECT clinic_id, count(*)::int AS n FROM pvs_event_log
       WHERE clinic_id IN ($1, $2) GROUP BY clinic_id`,
      [CLINIC_A.id, CLINIC_B.id]
    );
    let a = 0, b = 0;
    for (const r of res.rows) {
      if (r.clinic_id === CLINIC_A.id) a = r.n;
      if (r.clinic_id === CLINIC_B.id) b = r.n;
    }
    return { a, b };
  } catch {
    return { a: -1, b: -1 };
  }
}

async function vendorNetCents(): Promise<number> {
  try {
    const res = await query(
      VENDOR_DB_URL,
      `SELECT (COALESCE(SUM(betrag) FILTER (WHERE status = 'bezahlt' AND betrag > 0 AND termin_id IS NOT NULL), 0)
             + COALESCE(SUM(betrag) FILTER (WHERE betrag < 0), 0))::text AS net
       FROM rechnung`
    );
    return sqlNumericToCents(res.rows[0].net);
  } catch {
    return NaN;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  for (const c of [CLINIC_A, CLINIC_B]) {
    if (!existsSync(join(agentConfigDir(c.appdata), "config.json"))) {
      console.error(
        `Not set up (missing config for ${c.slug}). Run: pnpm --filter eins-bridge-soak setup`
      );
      process.exit(2);
    }
  }

  log("soak", `starting: duration ${Math.round(args.durationMs / 60000)} min, smoke=${args.smoke}, chaos=${args.chaos}, edge=${args.edge}`);

  // 1) Proxy (network chaos boundary). Reuse one if a previous run leaked it.
  let proxy: ProxyHandle | null = null;
  if (!(await proxyAlreadyRunning())) proxy = await startProxy();
  setProxyMode("pass");

  // 2) Agents.
  const agentA = new AgentHandle("A", CLINIC_A.appdata, join(LOG_DIR, "agent-a.log"));
  const agentB = new AgentHandle("B", CLINIC_B.appdata, join(LOG_DIR, "agent-b.log"));
  agentA.start();
  agentB.start();

  // 3) Load generators.
  const churn: ChurnHandle = startChurn({
    opsPerMinute: args.smoke ? 30 : 12,
    refundDwellMs: args.smoke ? 150_000 : 5 * 60_000,
    edge: args.edge,
  });
  const dropper: DropperHandle = startDropper({
    dropEveryMs: args.smoke ? 9_000 : 45_000,
    edge: args.edge,
  });

  // 4) Chaos.
  let chaos: ChaosHandle | null = null;
  if (args.chaos) {
    chaos = startChaos(
      {
        killAgent: (w) => (w === "A" ? agentA.kill() : agentB.kill()),
        restartAgent: (w) => (w === "A" ? agentA.restart() : agentB.restart()),
        updateAgentDbCredential: (pw) =>
          writeDbCredential(CLINIC_A.appdata, "tomedo-db-default", pw),
      },
      { smoke: args.smoke }
    );
  }

  // 5) Status ticker.
  let ticking = true;
  const ticker = (async () => {
    const interval = args.smoke ? 20_000 : 60_000;
    while (ticking) {
      await sleep(interval);
      if (!ticking) break;
      const counts = await portalEventCounts();
      const netA = await vendorNetCents();
      const c = churn.stats();
      const d = dropper.stats();
      log(
        "status",
        `A:${agentA.alive() ? "up" : "DOWN"} B:${agentB.alive() ? "up" : "DOWN"} ` +
          `net:${getProxyMode()} | churn ops=${c.ops} err=${c.errors} quelleA=${Number.isNaN(netA) ? "?" : fmtEur(netA)} | ` +
          `drops=${d.drops} quelleB=${fmtEur(d.paidCents - d.refundCents)}(delta) | ` +
          `portal events A=${counts.a} B=${counts.b}` +
          (chaos ? ` | chaos=${chaos.events()}` : "")
      );
    }
  })();

  // 6) Deadline / Ctrl+C.
  let earlyStop = false;
  const deadline = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, args.durationMs);
    process.on("SIGINT", () => {
      warn("soak", "SIGINT — stopping early, draining + reconciling");
      earlyStop = true;
      clearTimeout(t);
      resolve();
    });
  });
  await deadline;

  // 7) Shutdown sequence: stop generators, keep agents ALIVE to drain.
  log("soak", "load phase over — stopping generators, letting agents drain");
  if (chaos) await chaos.stop();
  setProxyMode("pass");
  await churn.stop();
  await dropper.stop();

  // Drain: fixed floor (poll interval + flush + backoff headroom), then wait
  // for the portal event count to go quiet.
  const floorMs = args.smoke ? 150_000 : 5 * 60_000;
  log("soak", `drain: waiting ${Math.round(floorMs / 1000)}s floor, then for portal counts to settle`);
  await sleep(floorMs);
  let last = await portalEventCounts();
  let stable = 0;
  const drainDeadline = Date.now() + (args.smoke ? 3 : 10) * 60_000;
  while (stable < 3 && Date.now() < drainDeadline) {
    await sleep(20_000);
    const now = await portalEventCounts();
    if (now.a === last.a && now.b === last.b) stable++;
    else stable = 0;
    last = now;
  }
  log("soak", `drain complete (portal events A=${last.a} B=${last.b}, stable=${stable >= 3})`);

  // 8) Reconcile while agents still run (a late flush can only help), then
  //    shut everything down.
  ticking = false;
  await ticker;
  const result = await reconcile(args.smoke ? 120 : 240);

  await agentA.shutdown();
  await agentB.shutdown();
  await proxy?.close();

  log("soak", `agent restarts by watchdog: A=${agentA.restarts} B=${agentB.restarts}`);
  log(
    "soak",
    result.ok
      ? `PASS — Quelle und Portal stimmen centgenau überein.${earlyStop ? " (early stop)" : ""}`
      : `FAIL — ${result.hardFailures} hard finding(s). See .runtime/soak-report.md`
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[soak] FATAL:", err);
  process.exit(2);
});
