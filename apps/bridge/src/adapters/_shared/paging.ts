/**
 * Shared paging + 429 helpers for the REST polling clients (tomedo, pabau,
 * consentz). Before this the three clients each carried their own copy of the
 * page loop (unbounded, buffering via the adapters), the Retry-After parser and
 * a non-abortable sleep.
 */

/** Upper bound on a single 429 back-off, so a bogus Retry-After can't park a
 *  link's worker for hours. */
export const MAX_RETRY_AFTER_MS = 5 * 60_000;
/** Cap on consecutive 429 retries for one request; on the cap we throw and let
 *  recordFailure back the link off instead of looping forever. */
export const MAX_RETRIES = 5;
/** Default cap on pages walked per stream per poll. */
export const DEFAULT_MAX_PAGES = 50;

export interface Page<T> {
  rows: T[];
  /** Position to request next: a page number (pabau/consentz) or an offset
   *  (tomedo). Persisted as the initial-sync resume token. */
  next: number;
  /** Terminal marker (rows is empty): the page cap was hit while the vendor
   *  was still returning data, so the stream is NOT drained. */
  truncated?: boolean;
}

export interface PageOptions {
  signal?: AbortSignal;
  /** Resume position (page number / offset). Default: the first page. */
  startAt?: number;
  /** Stop after this many non-empty pages (see Page.truncated). */
  maxPages?: number;
}

/** Retry-After is delta-seconds per HTTP spec, but a proxy may emit an
 *  HTTP-date. Accept either, clamp to MAX_RETRY_AFTER_MS, and never return
 *  NaN/0 (which would spin the retry loop). */
export function parseRetryAfter(raw: string | null): number {
  if (!raw) return 5_000;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt > 0) {
    return Math.min(asInt * 1000, MAX_RETRY_AFTER_MS);
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? Math.min(delta, MAX_RETRY_AFTER_MS) : 5_000;
  }
  return 5_000;
}

/** setTimeout sleep that rejects as soon as `signal` aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A vendor answered a list request with a non-2xx status. The status is kept as
 * a field so the stream engine can tell "this optional stream is not enabled
 * for the account" (401/403/404) from a real outage without parsing messages.
 */
export class VendorHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "VendorHttpError";
  }
}

/** Cap a string for safe inclusion in an error/log line. */
export function truncateText(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function firstId(rows: unknown[]): string | undefined {
  const id = (rows[0] as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

/**
 * Walk a vendor's pages: bounded, abortable, and loud about a vendor that
 * ignores the paging parameters.
 *
 *   - ends on an EMPTY page (H17: a short page is not the end, a server may
 *     clamp the page size);
 *   - ends with a `truncated` marker after `maxPages` non-empty pages;
 *   - throws when two consecutive pages start with the same row id: the vendor
 *     is returning the same page for every request (ignores page/offset), which
 *     would otherwise loop to the cap re-posting one page, or forever.
 */
export async function* walkPages<T>(opts: {
  label: string;
  startAt: number;
  maxPages: number;
  signal?: AbortSignal;
  fetchPage: (at: number) => Promise<T[]>;
  advance: (at: number, rows: T[]) => number;
}): AsyncIterable<Page<T>> {
  let at = opts.startAt;
  let prevFirst: string | undefined;
  let pages = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    if (pages >= opts.maxPages) {
      yield { rows: [], next: at, truncated: true };
      return;
    }
    const rows = await opts.fetchPage(at);
    if (rows.length === 0) return;
    const first = firstId(rows);
    if (first !== undefined && first === prevFirst) {
      throw new Error(
        `${opts.label}: vendor ignores paging (two consecutive pages start with the same id); stopping`
      );
    }
    prevFirst = first;
    pages += 1;
    const next = opts.advance(at, rows);
    yield { rows, next };
    at = next;
  }
}
