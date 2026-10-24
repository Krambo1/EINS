import { open, rename, unlink } from "node:fs/promises";

/**
 * Crash-safe file replacement: write a sibling temp file, fsync it, then rename
 * it over the target. After a power cut the target is either the complete old
 * file or the complete new one, never empty or torn.
 *
 * Two details that matter for the files this agent keeps (config.json, DPAPI
 * key blobs):
 *
 *   - fsync BEFORE the rename. Without it NTFS can commit the rename but not
 *     the data blocks, and a power cut leaves a zero-length "new" file that has
 *     already replaced the good one. For the outbox master key that means a
 *     permanently unreadable outbox.
 *   - NO unlink-then-rename fallback. Windows can refuse a rename-over-existing
 *     for a moment while an antivirus scanner holds the target; deleting the old
 *     file first opens a window in which a crash loses both copies. We retry the
 *     rename with a short back-off instead, and on persistent failure leave the
 *     old target untouched and the temp file in place for forensics.
 */
const RENAME_ATTEMPTS = 6;

export async function atomicWriteFile(
  path: string,
  data: string | Buffer,
  opts: { mode?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tmp = `${path}.tmp-${process.pid}`;
  const fh = await open(tmp, "w", opts.mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw err;
  }
  await fh.close();

  let lastErr: unknown;
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      // Only the transient Windows sharing-violation family is worth retrying.
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
      await sleep(100 * attempt);
    }
  }
  throw lastErr;
}
