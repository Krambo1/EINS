import { instantFromBerlinWall } from "@/lib/werkstunden";

/**
 * Parse the value of an `<input type="datetime-local">` ("2026-10-08T14:00",
 * optionally with seconds) as Berlin wall-clock time. The browser sends the
 * value without a zone; `new Date(value)` on a UTC server would read it as
 * 14:00 UTC, which is 16:00 in Berlin during summer time.
 *
 * Returns null for anything that is not a real calendar date and time.
 */
export function parseBerlinLocalInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  // Date.UTC rolls 2026-02-31 over into March; reject instead of guessing.
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d) ||
    check.getUTCHours() !== Number(h) ||
    check.getUTCMinutes() !== Number(mi)
  ) {
    return null;
  }
  return instantFromBerlinWall(wall);
}
