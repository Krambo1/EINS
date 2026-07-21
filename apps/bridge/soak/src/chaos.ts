import { CHAOS_JOURNAL, DB_PASSWORD_FILE, PG_SUPER_URL, VENDOR_READER_USER } from "./lib/env.js";
import { query } from "./lib/pg.js";
import {
  appendJsonl,
  chance,
  log,
  pickWeighted,
  randInt,
  readJsonFile,
  sleep,
  writeJsonFile,
} from "./lib/util.js";
import { setProxyMode, type ProxyMode } from "./proxy.js";

/**
 * Chaos injector. Runs one event at a time (no overlap) with a random gap:
 *
 *   killRestart   — SIGKILL an agent mid-flight, restart after a pause
 *   netRefuse     — proxy refuses connections (portal "down")
 *   netBlackhole  — proxy accepts and never answers (hung upstream, tests
 *                   the agent's request timeout)
 *   dbRotate      — ALTER ROLE on the vendor DB so the agent's polls fail;
 *                   recovery is either rotating the password back (ops fixed
 *                   the DB) or updating the agent's stored credential +
 *                   restart (ops fixed the agent) — 50/50
 *   blackout      — kill BOTH agents + refuse network for a while, then
 *                   restart everything (poor man's "reboot the machine";
 *                   a real reboot stays a manual step, see README)
 *
 * The agent must lose ZERO financial events through any of this — that is
 * the whole point of the outbox + cursor design, and exactly what the final
 * reconciliation asserts.
 */

export interface ChaosControls {
  /** Hard-kill the agent process (no auto-restart until restartAgent). */
  killAgent: (which: "A" | "B") => void;
  restartAgent: (which: "A" | "B") => void;
  /** Re-store the vendor-DB credential in agent A's DPAPI store. */
  updateAgentDbCredential: (password: string) => Promise<void>;
}

export interface ChaosOpts {
  /** Gap between chaos events. */
  minGapMs?: number;
  maxGapMs?: number;
  /** Scale for outage durations (smoke uses short ones). */
  smoke?: boolean;
}

export interface ChaosHandle {
  stop: () => Promise<void>;
  events: () => number;
}

export function startChaos(controls: ChaosControls, opts: ChaosOpts = {}): ChaosHandle {
  const smoke = opts.smoke ?? false;
  const minGap = opts.minGapMs ?? (smoke ? 45_000 : 10 * 60_000);
  const maxGap = opts.maxGapMs ?? (smoke ? 100_000 : 40 * 60_000);
  let running = true;
  let count = 0;
  let rotateN = 0;

  const journal = (e: Record<string, unknown>) => appendJsonl(CHAOS_JOURNAL, e);

  const dur = (longMs: number, smokeMs: number) => (smoke ? smokeMs : longMs);

  async function evKillRestart(): Promise<void> {
    const which = chance(0.5) ? "A" : "B";
    const pause = dur(randInt(10_000, 90_000), randInt(5_000, 15_000));
    journal({ ev: "killRestart", which, pauseMs: pause });
    log("chaos", `KILL agent ${which}, restart in ${Math.round(pause / 1000)}s`);
    controls.killAgent(which);
    await sleep(pause);
    controls.restartAgent(which);
  }

  async function evNet(mode: ProxyMode, longMs: number, smokeMs: number): Promise<void> {
    const outage = dur(longMs, smokeMs);
    journal({ ev: `net.${mode}`, outageMs: outage });
    log("chaos", `NETWORK ${mode} for ${Math.round(outage / 1000)}s`);
    setProxyMode(mode);
    await sleep(outage);
    setProxyMode("pass");
    journal({ ev: "net.pass" });
    log("chaos", "network restored");
  }

  async function evDbRotate(): Promise<void> {
    rotateN++;
    const { password: oldPw } = readJsonFile<{ password: string }>(DB_PASSWORD_FILE, {
      password: "",
    });
    const newPw = `soak_rot_${Date.now() % 1_000_000}_${rotateN}`;
    journal({ ev: "dbRotate.start" });
    log("chaos", "DB PASSWORD rotated — agent A polls will start failing");
    await query(PG_SUPER_URL, `ALTER ROLE ${VENDOR_READER_USER} WITH PASSWORD '${newPw}'`);
    writeJsonFile(DB_PASSWORD_FILE, { password: newPw });

    await sleep(dur(randInt(90_000, 200_000), randInt(35_000, 60_000)));

    if (chance(0.5) && oldPw) {
      // Recovery path 1: ops rotates the DB back.
      await query(PG_SUPER_URL, `ALTER ROLE ${VENDOR_READER_USER} WITH PASSWORD '${oldPw}'`);
      writeJsonFile(DB_PASSWORD_FILE, { password: oldPw });
      journal({ ev: "dbRotate.recoveredViaDb" });
      log("chaos", "DB password restored (DB-side recovery); polls resume after backoff");
    } else {
      // Recovery path 2: ops updates the agent credential + restarts it.
      await controls.updateAgentDbCredential(newPw);
      controls.killAgent("A");
      await sleep(3000);
      controls.restartAgent("A");
      journal({ ev: "dbRotate.recoveredViaCredential" });
      log("chaos", "agent credential updated + agent A restarted (agent-side recovery)");
    }
  }

  async function evBlackout(): Promise<void> {
    const outage = dur(randInt(60_000, 180_000), randInt(20_000, 40_000));
    journal({ ev: "blackout.start", outageMs: outage });
    log("chaos", `BLACKOUT: killing both agents + network for ${Math.round(outage / 1000)}s`);
    controls.killAgent("A");
    controls.killAgent("B");
    setProxyMode("refuse");
    await sleep(outage);
    setProxyMode("pass");
    controls.restartAgent("A");
    controls.restartAgent("B");
    journal({ ev: "blackout.end" });
    log("chaos", "blackout over, agents restarted");
  }

  const loop = (async () => {
    while (running) {
      await sleep(randInt(minGap, maxGap));
      if (!running) break;
      const ev = pickWeighted<() => Promise<void>>([
        [30, evKillRestart],
        [22, () => evNet("refuse", randInt(60_000, 8 * 60_000), randInt(20_000, 45_000))],
        [14, () => evNet("blackhole", randInt(45_000, 120_000), 35_000)],
        [17, evDbRotate],
        [17, evBlackout],
      ]);
      try {
        await ev();
        count++;
      } catch (err) {
        journal({ ev: "ERROR", message: (err as Error).message });
        log("chaos", `event failed: ${(err as Error).message}`);
        // Fail safe: whatever broke, make sure the network is back on.
        setProxyMode("pass");
      }
    }
  })();

  return {
    stop: async () => {
      running = false;
      await loop;
      setProxyMode("pass");
      log("chaos", `stopped after ${count} events`);
    },
    events: () => count,
  };
}
