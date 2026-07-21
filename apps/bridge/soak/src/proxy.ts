import net from "node:net";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { PROXY_MODE_FILE, PROXY_PORT, PORTAL_URL } from "./lib/env.js";
import { ensureDir, log } from "./lib/util.js";

/**
 * Chaos TCP proxy. Both agents are enrolled with portalBaseUrl =
 * http://127.0.0.1:<PROXY_PORT>; this proxy forwards to the real local
 * portal. "Cut the network" is then a mode flip, no firewall rules needed:
 *
 *   pass       — forward bytes both ways (normal operation)
 *   refuse     — destroy inbound sockets immediately (ECONNRESET at the
 *                agent; models portal down / connection refused)
 *   blackhole  — accept the connection, read the request, never answer
 *                (models a hung upstream; exercises the agent's 30s
 *                request timeout / AbortController path)
 *
 * The mode lives in a state file so the chaos loop (same or different
 * process) can flip it without IPC.
 */

export type ProxyMode = "pass" | "refuse" | "blackhole";

export function setProxyMode(mode: ProxyMode): void {
  ensureDir(dirname(PROXY_MODE_FILE));
  writeFileSync(PROXY_MODE_FILE, mode, "utf8");
}

export function getProxyMode(): ProxyMode {
  try {
    const raw = readFileSync(PROXY_MODE_FILE, "utf8").trim();
    if (raw === "refuse" || raw === "blackhole") return raw;
    return "pass";
  } catch {
    return "pass";
  }
}

export interface ProxyHandle {
  close: () => Promise<void>;
  port: number;
}

export function startProxy(): Promise<ProxyHandle> {
  const target = new URL(PORTAL_URL);
  const targetHost = target.hostname;
  const targetPort = Number(target.port || 80);
  if (!existsSync(PROXY_MODE_FILE)) setProxyMode("pass");

  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());

    const mode = getProxyMode();
    if (mode === "refuse") {
      client.destroy();
      return;
    }
    if (mode === "blackhole") {
      // Swallow the request; never respond. Safety-release after 120s so a
      // long blackhole window can't accumulate unbounded half-open sockets.
      client.on("data", () => {});
      const timer = setTimeout(() => client.destroy(), 120_000);
      client.on("close", () => clearTimeout(timer));
      return;
    }
    const upstream = net.connect(targetPort, targetHost);
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => {
      upstream.destroy();
      client.destroy();
    });
    client.on("error", () => upstream.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROXY_PORT, "127.0.0.1", () => {
      log("proxy", `listening on 127.0.0.1:${PROXY_PORT} → ${targetHost}:${targetPort}`);
      resolve({
        port: PROXY_PORT,
        close: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

/** True when something (usually another soak process) already listens. */
export function proxyAlreadyRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(PROXY_PORT, "127.0.0.1");
    const timer = setTimeout(() => {
      probe.destroy();
      resolve(false);
    }, 500);
    probe.on("connect", () => {
      clearTimeout(timer);
      probe.destroy();
      resolve(true);
    });
    probe.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
