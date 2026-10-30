/**
 * Which calls the call cards show while saves are running (optimistic UI of
 * "Jetzt anrufen"): the server's order minus the calls just logged, so the
 * next patient is on the card the moment a result is tapped.
 */

/** One result being saved: which call, and a number that is unique per tap. */
export interface LogEntry {
  key: string;
  id: number;
}

/**
 * The calls to hide: every entry whose save has not failed. Entries are told
 * apart by `id`, not by `key`, so a failed save brings back only its own
 * patient and a second try of the same patient starts clean.
 */
export function hiddenKeys(entries: readonly LogEntry[], failed: ReadonlySet<number>): Set<string> {
  const hidden = new Set<string>();
  for (const e of entries) if (!failed.has(e.id)) hidden.add(e.key);
  return hidden;
}

export interface VisibleCalls {
  /** The patient on "Jetzt anrufen": the first call not hidden. */
  hero: string | null;
  /** The next `slots` calls not hidden, for "Als Nächstes". */
  rows: string[];
  /**
   * The server sent as many calls as it ever loads, so more may be waiting
   * behind them: with every one hidden, "nobody waiting" would be a guess.
   */
  moreMayExist: boolean;
}

export interface VisibleOptions {
  /**
   * Calls whose save failed while the user was already on another patient,
   * oldest first. They go back to the first rows of "Als Nächstes" and do not
   * pull the card away from the patient being worked on.
   */
  behind?: readonly string[];
  /**
   * The Wiederbehandlung the server forced into the last visible place
   * (mergeCallItems). While it is shown it stays in the last row instead of
   * drifting up with every call that leaves.
   */
  pinned?: string | null;
}

export function visibleCalls(
  order: readonly string[],
  hidden: ReadonlySet<string>,
  slots: number,
  loadedCap: number,
  { behind = [], pinned = null }: VisibleOptions = {}
): VisibleCalls {
  let open = order.filter((key) => !hidden.has(key));
  const pin = pinned && open.includes(pinned) ? pinned : null;
  if (pin) open = open.filter((key) => key !== pin);
  if (behind.length > 0) {
    // The newest failure takes the very first row, an older one follows it.
    const back = [...behind].reverse().filter((key) => open.includes(key));
    const rest = open.filter((key) => !back.includes(key));
    open = [...rest.slice(0, 1), ...back, ...rest.slice(1)];
  }
  // Hero plus `slots` rows: the last row is index `slots`.
  if (pin) open.splice(Math.min(slots, open.length), 0, pin);
  return {
    hero: open[0] ?? null,
    rows: open.slice(1, 1 + slots),
    moreMayExist: order.length >= loadedCap,
  };
}
