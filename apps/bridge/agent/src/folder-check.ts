import { stat } from "node:fs/promises";

/**
 * H13.1: return the subset of `folders` that do not exist on disk.
 *
 * A wrong or not-yet-created watch folder otherwise makes chokidar watch
 * nothing, the catch-up readdir swallow its error, and the agent stay green
 * while zero events flow forever. The agent stats every configured folder at
 * boot (and hourly after) and warns loudly, by exact path, on any miss.
 *
 * Pure but for the injected `statFn`, which defaults to node:fs stat and is
 * overridable in tests.
 */
export async function findMissingFolders(
  folders: string[],
  statFn: (p: string) => Promise<unknown> = (p) => stat(p)
): Promise<string[]> {
  const missing: string[] = [];
  for (const folder of folders) {
    if (!folder) continue;
    try {
      await statFn(folder);
    } catch {
      missing.push(folder);
    }
  }
  return missing;
}
