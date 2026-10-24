import type { CanonicalEvent } from "../../canonical/types.js";
import type { Page, PageOptions } from "./paging.js";
import { DEFAULT_MAX_PAGES, VendorHttpError } from "./paging.js";
import { isoUtc, shiftIso } from "./iso.js";

/**
 * Shared stream engine for the three REST polling adapters (tomedo, pabau,
 * consentz). They all expose the same five streams (patients, appointments,
 * encounters, invoices|payments, recalls) and the same cursor token, and used
 * to each buffer the whole poll in memory with a copy of this logic. The
 * engine yields CHUNKS (one per vendor page) so the scheduler can post and
 * checkpoint as it goes.
 *
 * Poll cursor model (fixes P1-5):
 *   - the cursor is one comma-separated ISO watermark per stream;
 *   - a poll reads each stream from `watermark - OVERLAP_MS` (late commits and
 *     equal-timestamp ties are re-fetched; the dedup ids are stable per row
 *     VERSION, see the adapters' normalizers, so the overlap is absorbed by the
 *     portal);
 *   - the new watermark is min(max(old, newest modified seen), pollStart): a
 *     row stamped in the future (or a vendor clock ahead of ours) can never
 *     park the stream in the future, it is simply re-read every poll;
 *   - it is only emitted AFTER every chunk of the stream was handed back and
 *     accepted (the generator is pulled lazily), so a failure mid-stream leaves
 *     the old watermark in place.
 *
 * Stream isolation: one broken stream must not starve the others. Each stream
 * is walked inside its own try/catch; a failure is remembered, the remaining
 * streams still run and persist their own watermark, and the failures are
 * rethrown as ONE aggregate error after the last stream so the scheduler still
 * records the failed poll. The revenue stream (invoices/payments) runs first
 * because it is the one the product is measured on. The optional streams
 * (encounters, recalls) answering 401/403/404 mean "not enabled for this
 * account": that is reported as a `disabledStream` chunk (a visible warning),
 * not as a failure.
 *
 * Page cap: at most `maxPages` pages per stream per poll. If the cap is hit and
 * the rows arrived in ascending modified order the watermark advances to the
 * newest row seen and the next poll continues where this one stopped. If the
 * vendor's order is NOT ascending (a descending or unordered backlog) the
 * watermark cannot advance mid-walk, so the walk goes on past the cap until the
 * stream ends or the poll's time budget (`deadlineAt`) runs out. In the second
 * case the position is persisted in the cursor token (see Resume) and the next
 * poll continues there instead of starting over, so a big backlog drains over a
 * few polls.
 *
 * Mutating result sets: page/offset paging over a set that changes while it is
 * read can skip rows. After a walk of more than one page the first page is
 * fetched once more; if its ids differ from what was read first, the watermark
 * is held at its pre-walk value so the next poll's overlap re-reads the window
 * (event ids are stable per row version, so the replay is absorbed by dedup).
 */

export const STREAM_NAMES = [
  "patients",
  "appointments",
  "encounters",
  "invoices",
  "recalls",
] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

export const EPOCH = "1970-01-01T00:00:00.000Z";
/** Poll overlap: re-read this far behind the watermark. */
export const OVERLAP_MS = 10 * 60_000;

export interface SyncChunk {
  /** Canonical events from one vendor page. May be empty (checkpoint-only chunk). */
  events: CanonicalEvent[];
  /** Token to persist once `events` were accepted: the poll cursor (after a
   *  stream finished) or the initial-sync resume token (after each page).
   *  null = nothing to persist for this chunk. */
  cursor: string | null;
  /** Rows the normalizer could not turn into events (counted, not fatal). */
  skippedRows?: number;
  /** The page cap or time budget cut this stream short: poll again soon. */
  more?: boolean;
  /** Which stream this chunk belongs to (REST adapters). Lets the scheduler
   *  account rejects per stream. */
  stream?: StreamName;
  /** An optional stream answered 401/403/404: not enabled for this account.
   *  The other streams carry on; the scheduler records a visible warning. */
  disabledStream?: { stream: StreamName; status: number; message: string };
}

export interface StreamSource {
  name: StreamName;
  pages(since: string, opts: PageOptions): AsyncIterable<Page<unknown>>;
  /** Row -> canonical events (0..n). */
  toEvents(row: unknown): CanonicalEvent[];
  /** The row's raw modified timestamp, as the vendor sent it. */
  modifiedAt(row: unknown): string | null | undefined;
}

export interface PollEngineOptions {
  signal?: AbortSignal;
  /** Poll start; the future clamp for new watermarks. */
  now: Date;
  /** IANA zone for zone-less vendor timestamps. */
  timezone: string;
  maxPages?: number;
  overlapMs?: number;
  /** Epoch ms after which no further page is pulled (the poll's time budget).
   *  Default: DEFAULT_WALK_BUDGET_MS from when the walk starts. */
  deadlineAt?: number;
  /** Streams the consumer has rejected while reading them (for example because
   *  most of their rows were permanently refused). The engine stops reading such
   *  a stream and leaves its watermark where it was. */
  failedStreams?: ReadonlySet<string>;
}

/** Default time budget for walking a poll's streams when the caller sets none. */
export const DEFAULT_WALK_BUDGET_MS = 8 * 60_000;

/** Revenue first: a broken or slow stream must never delay invoices/payments. */
const POLL_ORDER: readonly StreamName[] = [
  "invoices",
  "patients",
  "appointments",
  "encounters",
  "recalls",
];
/** Streams a vendor account may simply not have (module not licensed). */
const OPTIONAL_STREAMS: ReadonlySet<StreamName> = new Set<StreamName>(["encounters", "recalls"]);
const DISABLED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/** HTTP status when `err` means an optional stream is not enabled, else null. */
function disabledStatus(name: StreamName, err: unknown): number | null {
  return OPTIONAL_STREAMS.has(name) &&
    err instanceof VendorHttpError &&
    DISABLED_STATUSES.has(err.status)
    ? err.status
    : null;
}

type Cursors = Record<StreamName, string>;

export function parseCursors(input: string | null | undefined): Cursors {
  const parts = (input ?? "").split(",");
  const out = {} as Cursors;
  STREAM_NAMES.forEach((name, i) => {
    const raw = (parts[i] ?? "").trim();
    // Anything unparseable (empty, a leftover initial-sync token, garbage)
    // restarts that stream from the epoch rather than poisoning the query.
    out[name] = validTs(raw) ? isoUtc(raw) : EPOCH;
  });
  return out;
}

/**
 * A non-ascending stream whose walk ran out of time: where to continue. Stored
 * as a sixth comma-separated part (`stream@nextPosition@newestSeen`); the five
 * watermark parts stay exactly as before, so older readers ignore it. It is only
 * valid while that stream's watermark is unchanged (the watermark is held while
 * a resume is pending), which keeps the `since` filter, and so the page
 * positions, stable.
 */
export interface Resume {
  stream: StreamName;
  next: number;
  maxSeen: string;
}

export function serializeCursors(c: Cursors, resume?: Resume | null): string {
  const base = STREAM_NAMES.map((n) => c[n]).join(",");
  return resume ? `${base},${resume.stream}@${resume.next}@${resume.maxSeen}` : base;
}

export function parseResume(input: string | null | undefined): Resume | null {
  const raw = (input ?? "").split(",")[STREAM_NAMES.length];
  if (!raw) return null;
  const [stream, next, maxSeen = ""] = raw.trim().split("@");
  const pos = Number(next);
  if (
    !(STREAM_NAMES as readonly string[]).includes(stream ?? "") ||
    !Number.isInteger(pos) ||
    pos < 0 ||
    (maxSeen !== "" && !validTs(maxSeen))
  ) {
    return null;
  }
  return { stream: stream as StreamName, next: pos, maxSeen };
}

/** A cursor with every stream at `iso` (initial-sync watermark handoff, C7). */
export function seedCursors(iso: string): string {
  const c = {} as Cursors;
  for (const n of STREAM_NAMES) c[n] = iso;
  return serializeCursors(c);
}

/** ISO-looking AND parseable: Date.parse alone accepts junk like "x1" (-> 2001). */
const ISO_START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function validTs(iso: string): boolean {
  return ISO_START_RE.test(iso) && !Number.isNaN(Date.parse(iso));
}

function rowsToEvents(
  src: StreamSource,
  rows: unknown[]
): { events: CanonicalEvent[]; skipped: number } {
  const events: CanonicalEvent[] = [];
  let skipped = 0;
  for (const row of rows) {
    try {
      const evs = src.toEvents(row);
      if (evs.length === 0) skipped += 1;
      for (const e of evs) events.push(e);
    } catch {
      // A malformed row (null id, wrong types) must not abort the stream.
      skipped += 1;
    }
  }
  return { events, skipped };
}

function idsOf(rows: unknown[]): string {
  return rows.map((r) => String((r as { id?: unknown } | null)?.id ?? "")).join("\u0001");
}

/** Ids of the page at `startAt`, "" when it is empty now, null when unreadable. */
async function firstPageIds(
  src: StreamSource,
  since: string,
  startAt: number | undefined,
  signal: AbortSignal | undefined
): Promise<string | null> {
  for await (const page of src.pages(since, { signal, startAt, maxPages: 1 })) {
    return page.truncated ? null : idsOf(page.rows);
  }
  return "";
}

interface WalkState {
  cursors: Cursors;
  resume: { value: Resume | null };
  nowIso: string;
  overlap: number;
  maxPages: number;
  deadlineAt: number;
  opts: PollEngineOptions;
}

/**
 * Walk ONE stream for a poll. Yields its page chunks, then (unless the consumer
 * abandoned it) one cursor chunk. Returns "budget" when the poll's time budget
 * ran out (the caller stops the poll: later streams run next time), else "done".
 */
async function* walkStream(
  src: StreamSource,
  w: WalkState
): AsyncGenerator<SyncChunk, "done" | "budget"> {
  const { opts } = w;
  const name = src.name;
  const current = w.cursors[name];
  const resumeHere = w.resume.value?.stream === name ? w.resume.value : null;
  const since = current === EPOCH ? EPOCH : clampEpoch(shiftIso(current, -w.overlap));
  const budgetOver = () => Date.now() >= w.deadlineAt;

  let maxSeen = resumeHere?.maxSeen ?? "";
  let lastTs = "";
  // A resumed walk exists only because the vendor order was not ascending.
  let monotonic = resumeHere === null;
  let startAt: number | undefined = resumeHere?.next;
  const firstPos = startAt;
  let firstIds: string | null = null;
  let pagesRead = 0;
  let stopAt: number | null = null;
  let capNext: number | null = null;

  for (;;) {
    capNext = null;
    for await (const page of src.pages(since, { signal: opts.signal, maxPages: w.maxPages, startAt })) {
      if (page.truncated) {
        capNext = page.next;
        continue;
      }
      pagesRead += 1;
      if (pagesRead === 1) firstIds = idsOf(page.rows);
      for (const row of page.rows) {
        const ts = isoUtc(src.modifiedAt(row), opts.timezone);
        if (!validTs(ts)) continue;
        if (lastTs !== "" && ts < lastTs) monotonic = false;
        lastTs = ts;
        if (ts > maxSeen) maxSeen = ts;
      }
      const { events, skipped } = rowsToEvents(src, page.rows);
      yield { events, cursor: null, skippedRows: skipped, stream: name };
      // The consumer may have rejected this stream while handling the chunk.
      if (opts.failedStreams?.has(name)) return "done";
      if (budgetOver()) {
        stopAt = page.next;
        break;
      }
    }
    if (stopAt !== null || capNext === null) break;
    if (monotonic) break; // cap on an ascending stream: advance to the newest row seen
    if (budgetOver()) {
      stopAt = capNext;
      break;
    }
    // Not ascending: the watermark cannot advance mid-walk, so keep reading.
    startAt = capNext;
  }
  if (opts.failedStreams?.has(name)) return "done";

  const truncated = stopAt !== null || capNext !== null;

  if (truncated && !monotonic) {
    // Out of time on a stream whose order is not ascending: keep the watermark,
    // remember where to continue and what the newest row seen so far is.
    w.resume.value = { stream: name, next: stopAt ?? capNext!, maxSeen };
    yield { events: [], cursor: serializeCursors(w.cursors, w.resume.value), more: true, stream: name };
    return "budget";
  }

  // Never past the poll start, never backwards beyond what clamping forces.
  let next = maxSeen > current ? maxSeen : current;
  if (next > w.nowIso) next = w.nowIso;
  if (truncated && next <= current) {
    throw new Error(
      `${name}: page cap (${w.maxPages}) or time budget reached without the cursor advancing (more rows share one timestamp window than fit in the cap); ` +
        `raise connection_config.maxPagesPerPoll`
    );
  }

  let held = false;
  if (pagesRead > 1 && firstIds !== null) {
    const again = await firstPageIds(src, since, firstPos, opts.signal);
    if (again !== null && again !== firstIds) {
      held = true;
      console.warn(
        `[stream-sync] ${name}: the result set changed while it was paged; holding the watermark so the next poll re-reads the window`
      );
    }
  }
  if (!held) w.cursors[name] = next;
  if (resumeHere) w.resume.value = null;
  yield {
    events: [],
    cursor: serializeCursors(w.cursors, w.resume.value),
    // A held watermark polls at the normal cadence, not in a tight loop.
    more: truncated && !held,
    stream: name,
  };
  return stopAt !== null ? "budget" : "done";
}

/** Incremental poll as a stream of chunks. */
export async function* pollChunks(
  sources: StreamSource[],
  cursor: string | null,
  opts: PollEngineOptions
): AsyncIterable<SyncChunk> {
  const w: WalkState = {
    cursors: parseCursors(cursor),
    resume: { value: parseResume(cursor) },
    nowIso: opts.now.toISOString(),
    overlap: opts.overlapMs ?? OVERLAP_MS,
    maxPages: opts.maxPages ?? DEFAULT_MAX_PAGES,
    deadlineAt: opts.deadlineAt ?? Date.now() + DEFAULT_WALK_BUDGET_MS,
    opts,
  };
  const rank = (n: StreamName) => POLL_ORDER.indexOf(n);
  const ordered = [...sources].sort((a, b) => rank(a.name) - rank(b.name));
  // A stream with a pending resume goes first so its backlog actually drains.
  const pending = w.resume.value?.stream;
  if (pending) ordered.sort((a, b) => Number(b.name === pending) - Number(a.name === pending));

  const failures: string[] = [];
  for (const src of ordered) {
    try {
      const outcome = yield* walkStream(src, w);
      if (outcome === "budget") break;
    } catch (err) {
      // A cancelled poll (deadline, shutdown) is not a stream failure.
      if (opts.signal?.aborted) throw err;
      const status = disabledStatus(src.name, err);
      if (status !== null) {
        yield {
          events: [],
          cursor: null,
          stream: src.name,
          disabledStream: { stream: src.name, status, message: (err as Error).message },
        };
        continue;
      }
      failures.push(`${src.name}: ${(err as Error).message}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
}

function clampEpoch(iso: string): string {
  return iso < EPOCH ? EPOCH : iso;
}

// ---------------------------------------------------------------------------
// Initial sync (resumable)
// ---------------------------------------------------------------------------

/**
 * Resume token for the initial sync, persisted in
 * pvs_sync_status.last_incremental_cursor while the initial sync has not
 * completed (nothing polls until it has, so the column is free). Overwritten by
 * the seeded poll cursor on completion.
 */
export interface InitialSyncState {
  v: 1;
  /** First run's start: the poll watermark handed over on completion. */
  start: string;
  /** Lower bound of the backfill (start - initialSyncMonths). */
  since: string;
  /** Index into the source list of the stream in progress. */
  i: number;
  /** Next page position within that stream (page number / offset), or null
   *  to start the stream from its first page. */
  p: number | null;
}

export function serializeInitialState(s: InitialSyncState): string {
  return JSON.stringify(s);
}

export function parseInitialState(token: string | null | undefined): InitialSyncState | null {
  if (!token || !token.startsWith("{")) return null;
  try {
    const o = JSON.parse(token) as Partial<InitialSyncState>;
    if (
      o.v === 1 &&
      typeof o.start === "string" &&
      typeof o.since === "string" &&
      typeof o.i === "number" &&
      o.i >= 0 &&
      (o.p === null || typeof o.p === "number")
    ) {
      return o as InitialSyncState;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Initial sync as resumable chunks: one chunk per vendor page, each carrying
 * the resume token that points at the NEXT page. The consumer persists the
 * token after the chunk's events were accepted, so a restart (crash, deadline,
 * rate limit) continues instead of re-posting the whole history.
 */
export async function* initialChunks(
  sources: StreamSource[],
  state: InitialSyncState,
  opts: { signal?: AbortSignal }
): AsyncIterable<SyncChunk> {
  for (let i = state.i; i < sources.length; i++) {
    const src = sources[i]!;
    const startAt = i === state.i && state.p !== null ? state.p : undefined;
    try {
      for await (const page of src.pages(state.since, {
        signal: opts.signal,
        startAt,
        maxPages: Number.POSITIVE_INFINITY,
      })) {
        if (page.truncated) continue;
        const { events, skipped } = rowsToEvents(src, page.rows);
        yield {
          events,
          cursor: serializeInitialState({ ...state, i, p: page.next }),
          skippedRows: skipped,
          stream: src.name,
        };
      }
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const status = disabledStatus(src.name, err);
      if (status === null) throw err;
      // An optional stream the account does not have must not hold the whole
      // backfill hostage: skip it with a visible warning and move on. (The order
      // of the initial sync is unchanged: its resume token indexes into it.)
      yield {
        events: [],
        cursor: serializeInitialState({ ...state, i: i + 1, p: null }),
        stream: src.name,
        disabledStream: { stream: src.name, status, message: (err as Error).message },
      };
      continue;
    }
    yield {
      events: [],
      cursor: serializeInitialState({ ...state, i: i + 1, p: null }),
      stream: src.name,
    };
  }
}
