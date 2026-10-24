import { readFileSync } from "node:fs";

/**
 * Detects an installer that shipped a different node.exe than the one the
 * bundle was built for.
 *
 * better-sqlite3-multiple-ciphers (the encrypted outbox) is a V8-ABI native
 * addon: its binary loads only under the Node major it was built for. The
 * bundle script (scripts/bundle.mjs) refuses to build under the wrong Node and
 * stamps `build-info.json` next to dist/. At startup the agent compares that
 * stamp with the Node it is actually running under, so a mismatched node.exe is
 * reported as one clear line instead of "Could not locate the bindings file"
 * from deep inside the first database open.
 *
 * The stamp only exists in a built bundle; from sources (tsx / plain tsc
 * output) there is nothing to compare and the check is skipped.
 */

export interface BuildInfo {
  agentVersion?: string;
  nodeVersion: string;
  /** process.versions.modules of the building Node (NODE_MODULE_VERSION). */
  abi: string;
  platform: string;
  arch: string;
  builtAt?: string;
}

export interface RuntimeFacts {
  versions: { node: string; modules: string };
  platform: string;
  arch: string;
}

export function evaluateRuntime(
  info: BuildInfo,
  runtime: RuntimeFacts = {
    versions: { node: process.versions.node, modules: process.versions.modules },
    platform: process.platform,
    arch: process.arch,
  }
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (info.abi !== runtime.versions.modules) {
    problems.push(
      `Der Agent wurde für Node ${info.nodeVersion} (ABI ${info.abi}) gebaut, läuft aber unter ` +
        `Node ${runtime.versions.node} (ABI ${runtime.versions.modules}). Die verschlüsselte Warteschlange ` +
        `lässt sich so nicht öffnen. Bitte die mitgelieferte node.exe verwenden. ` +
        `/ This agent bundle was built for Node ${info.nodeVersion} (ABI ${info.abi}) but runs under ` +
        `Node ${runtime.versions.node} (ABI ${runtime.versions.modules}); the native SQLite module ` +
        `will not load. Use the node.exe shipped with the bundle.`
    );
  }
  if (info.platform !== runtime.platform || info.arch !== runtime.arch) {
    problems.push(
      `Der Agent wurde für ${info.platform}-${info.arch} gebaut, läuft aber auf ` +
        `${runtime.platform}-${runtime.arch}. / Bundle built for ${info.platform}-${info.arch}, ` +
        `running on ${runtime.platform}-${runtime.arch}.`
    );
  }
  return { ok: problems.length === 0, problems };
}

/** Parse build-info.json; null when absent or unusable. */
export function readBuildInfo(path: string): BuildInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BuildInfo>;
    if (
      typeof parsed.abi === "string" &&
      typeof parsed.nodeVersion === "string" &&
      typeof parsed.platform === "string" &&
      typeof parsed.arch === "string"
    ) {
      return parsed as BuildInfo;
    }
    return null;
  } catch {
    return null;
  }
}
