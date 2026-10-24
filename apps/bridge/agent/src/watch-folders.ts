import { posix } from "node:path";

/**
 * Config validation for the two file watch folders.
 *
 * The GDT receive folder and the Honorar CSV folder must be different folders:
 * both watchers would otherwise work in the same directory, the GDT watcher
 * claiming files by rename into `.eins\processing` while the CSV watcher
 * rescans the same files, and a misconfigured export would be consumed by the
 * wrong path. Pure and dependency-free so enrollment (before the one-time token
 * is spent), `--configure-honorar` and the run mode can all use it.
 */

/** Looks like a Windows path (drive letter, UNC, or backslashes). */
function isWindowsStyle(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith("\\\\") || p.includes("\\");
}

/** Comparable form of a folder path: separators, trailing slash and (Windows) case folded. */
export function comparableFolder(p: string): string {
  const trimmed = p.trim();
  if (isWindowsStyle(trimmed) || trimmed.startsWith("//")) {
    const unc = trimmed.startsWith("\\\\") || trimmed.startsWith("//");
    const slashed = trimmed.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const body = slashed.replace(/\/+$/, "");
    return (unc ? `/${body}` : body).toLowerCase();
  }
  const normalized = posix.normalize(trimmed);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

/**
 * Returns an operator-readable message when the GDT folder and the Honorar CSV
 * folder are the same folder, else null.
 */
export function watchFolderConflict(cfg: {
  watchFolder?: string | null;
  honorarCsvFolder?: string | null;
}): string | null {
  const gdt = cfg.watchFolder?.trim();
  const csv = cfg.honorarCsvFolder?.trim();
  if (!gdt || !csv) return null;
  if (comparableFolder(gdt) !== comparableFolder(csv)) return null;
  return (
    `Der GDT-Ordner und der Honorar-CSV-Ordner sind derselbe Ordner (${gdt}). ` +
    `Bitte zwei getrennte Ordner verwenden. ` +
    `/ The GDT receive folder and the Honorar CSV folder are the same folder (${gdt}); ` +
    `configure two separate folders.`
  );
}
