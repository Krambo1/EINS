import { env } from "./config.js";
import { signBody } from "./canonical/sign.js";
import { loadClinicPvsSecret } from "./db/client.js";
import { fetchWithTimeout } from "./http.js";
import { sanitizeEvents } from "./canonical/sanitize.js";
import type { CanonicalEvent } from "./canonical/types.js";

/**
 * Bridge → Portal POST client.
 *
 * Loads the clinic's per-clinic PVS HMAC secret from `platform_credentials`,
 * signs the body, POSTs to `/api/pvs/events` (<5 events) or
 * `/api/pvs/events/batch` (up to 200 per request here; the portal cap is 500).
 *
 * The contract postAll() gives its callers is PER-EVENT outcomes, because the
 * portal validates each event individually (a batch answers 201 with `results`
 * aligned 1:1 with the input):
 *
 *   ingested / deduped / quarantined   accepted, cursor may pass them
 *   skipped (permanent)                the portal will never accept this event
 *                                      (billing_conflict, invalid_envelope,
 *                                      invalid_bridge_source, clinic_not_found,
 *                                      clinic_mismatch): logged by reason and
 *                                      SKIPPED so one poison row can never hold a
 *                                      practice's checkpoint hostage
 *   errors (retryable)                 network errors, 408/429/5xx, 409,
 *                                      link_not_ready, vendor_mismatch,
 *                                      internal_error, rate_limited and anything
 *                                      unknown: these (and only these) block the
 *                                      checkpoint
 *
 * Success means HTTP 201/202 AND a JSON body with ok:true and numeric counts
 * (or `results`); any other 2xx is NOT an ingest. Redirects are errors.
 *
 * Cached secrets are held in memory for SECRET_CACHE_TTL_MS so initial-sync
 * doesn't re-decrypt on every send. The cache is keyed by clinicId and
 * invalidated when the portal returns 400/401 (likely rotation).
 */

const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;
const BATCH_THRESHOLD = 5;
const BATCH_MAX = 500;
/** Events per batch request from postAll. Below the portal cap of 500 so a
 *  request stays small and well inside the portal route's 60 s maxDuration. */
export const POST_CHUNK = 200;
/** The portal route has maxDuration 60: give the batch POST the same. */
const BATCH_TIMEOUT_MS = 60_000;
const RETRY_AFTER_CAP_MS = 15 * 60_000;
/** Max extra requests one postAll call may spend bisecting a chunk the portal
 *  rejected as a whole, to isolate the poison event(s). */
const BISECT_REQUEST_BUDGET = 24;

/** Per-event reasons the portal will never accept; everything else retries. */
const PERMANENT_REASONS = new Set([
  "billing_conflict",
  "invalid_envelope",
  "invalid_bridge_source",
  "clinic_not_found",
  "clinic_mismatch",
]);

interface CacheEntry {
  secret: string;
  expiresAt: number;
}
const secretCache = new Map<string, CacheEntry>();

async function getSecret(clinicId: string): Promise<string | null> {
  const cached = secretCache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.secret;
  }
  const fresh = await loadClinicPvsSecret(clinicId);
  if (!fresh) return null;
  secretCache.set(clinicId, {
    secret: fresh,
    expiresAt: Date.now() + SECRET_CACHE_TTL_MS,
  });
  return fresh;
}

export interface PostResult {
  /** True only for HTTP 201/202 with a well-formed ok:true body. */
  ok: boolean;
  status: number;
  body: unknown;
  /** Parsed Retry-After (ms), when the portal sent one. */
  retryAfterMs?: number;
  /** Set when no HTTP response was received (network error / timeout). */
  networkError?: string;
}

function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(Math.ceil(secs * 1000), RETRY_AFTER_CAP_MS);
  }
  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    return Math.min(Math.max(at - Date.now(), 0), RETRY_AFTER_CAP_MS);
  }
  return undefined;
}

async function send(
  clinicId: string,
  path: string,
  raw: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PostResult> {
  const secret = await getSecret(clinicId);
  if (!secret) {
    return { ok: false, status: 0, body: { error: "no_secret_for_clinic" } };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${env().PORTAL_BASE_URL}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eins-signature": signBody(raw, secret),
        },
        body: raw,
        redirect: "error",
        signal,
      },
      timeoutMs
    );
  } catch (err) {
    if (signal?.aborted) throw err; // cancelled by the caller: not a portal failure
    const e = err as Error;
    return {
      ok: false,
      status: 0,
      body: { error: "network" },
      networkError: `${e.name}: ${e.message}`.slice(0, 200),
    };
  }
  const body = (await res.json().catch(() => ({}))) as unknown;
  if (res.status === 400 || res.status === 401) {
    // Likely secret rotated. Drop cache so next call re-loads.
    secretCache.delete(clinicId);
  }
  const ok =
    (res.status === 201 || res.status === 202) &&
    !!body &&
    typeof body === "object" &&
    (body as { ok?: unknown }).ok === true;
  return {
    ok,
    status: res.status,
    body,
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
  };
}

/** POST a single event. */
export async function postEvent(
  event: CanonicalEvent,
  signal?: AbortSignal
): Promise<PostResult> {
  return send(event.clinicId, "/api/pvs/events", JSON.stringify(event), 30_000, signal);
}

/**
 * POST a batch of events for one clinic (raw, no per-event interpretation: see
 * postAll for that). Callers chunk; this does not split silently.
 */
export async function postBatch(
  clinicId: string,
  events: CanonicalEvent[],
  signal?: AbortSignal
): Promise<PostResult> {
  if (events.length === 0) return { ok: true, status: 201, body: { ok: true, ingested: 0 } };
  if (events.length === 1) return postEvent(events[0]!, signal);
  if (events.length > BATCH_MAX) {
    throw new Error(`postBatch: max ${BATCH_MAX} events per call, got ${events.length}`);
  }
  return send(
    clinicId,
    "/api/pvs/events/batch",
    JSON.stringify({ clinicId, events }),
    BATCH_TIMEOUT_MS,
    signal
  );
}

// ---------------------------------------------------------------------------
// Per-event outcomes
// ---------------------------------------------------------------------------

export type EventOutcome =
  | { t: "ingested" }
  | { t: "deduped" }
  | { t: "quarantined" }
  | { t: "skip"; reason: string }
  | { t: "retry"; reason: string };

interface ChunkResult {
  outcomes: EventOutcome[];
  /** The whole request failed in a way that makes sending more chunks pointless. */
  stop?: boolean;
  /** The portal rejected the chunk as a whole for a shape reason: bisect. */
  bisect?: boolean;
  retryAfterMs?: number;
  httpStatus?: number;
}

function errorCode(body: unknown): string | undefined {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === "string") return e;
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : undefined;
}

function classifyReason(reason: string): "skip" | "retry" {
  return PERMANENT_REASONS.has(reason) ? "skip" : "retry";
}

function allOf(n: number, o: EventOutcome): EventOutcome[] {
  return Array.from({ length: n }, () => o);
}

/** Interpret a non-accepted whole-request response for `n` events. */
function classifyFailure(r: PostResult, n: number): ChunkResult {
  const base = { retryAfterMs: r.retryAfterMs, httpStatus: r.status };
  if (r.networkError) {
    return { ...base, outcomes: allOf(n, { t: "retry", reason: `network: ${r.networkError}` }), stop: true };
  }
  const code = errorCode(r.body);
  const s = r.status;
  const retryAll = (reason: string, stop = true): ChunkResult => ({
    ...base,
    outcomes: allOf(n, { t: "retry", reason }),
    stop,
  });
  if (s === 0) return retryAll(code ?? "no_secret_for_clinic");
  if (s === 429) return retryAll("rate_limited");
  // 401 / "invalid_request" is the signature check: a rotated secret. Losing
  // data to it would be worse than waiting, so it BLOCKS (cache already dropped).
  if (s === 401 || (s === 400 && code === "invalid_request")) return retryAll("auth_rejected");
  if (s === 408 || s >= 500) return retryAll(code ?? `http_${s}`);
  if (s === 409) return retryAll(code ?? "http_409", false);
  if (code === "clinic_not_found") {
    // Clinic-wide: every event of this request is equally unacceptable.
    return { ...base, outcomes: allOf(n, { t: "skip", reason: code }) };
  }
  if (code && PERMANENT_REASONS.has(code)) {
    // A permanent reason on a whole request: for a single event it is that
    // event's verdict; for a batch it only says SOME event is bad, so bisect to
    // find which instead of skipping the innocent ones with it.
    return {
      ...base,
      outcomes: allOf(n, { t: "skip", reason: code }),
      bisect: n > 1,
    };
  }
  // 400 invalid_envelope-shaped / 413 / 422 without a known reason: a shape
  // problem somewhere in the chunk. Bisect to isolate it instead of skipping
  // the whole chunk or blocking forever.
  if (s === 400 || s === 413 || s === 422) {
    return { ...base, outcomes: allOf(n, { t: "skip", reason: code ?? `http_${s}` }), bisect: true };
  }
  // 404 without clinic_not_found is a wrong PORTAL_BASE_URL; 403, 3xx and any
  // other 2xx are not acceptance either. All retryable (surfaced via last_error).
  return retryAll(code ?? (s >= 200 && s < 300 ? `unexpected_status_${s}` : `http_${s}`));
}

function interpretSingle(r: PostResult): ChunkResult {
  if (r.ok) {
    const st = (r.body as { status?: unknown }).status;
    return {
      httpStatus: r.status,
      outcomes: [
        st === "deduped"
          ? { t: "deduped" }
          : st === "quarantined" || r.status === 202
            ? { t: "quarantined" }
            : { t: "ingested" },
      ],
    };
  }
  return classifyFailure(r, 1);
}

function interpretBatch(r: PostResult, n: number): ChunkResult {
  if (!r.ok) return classifyFailure(r, n);
  const body = r.body as {
    ingested?: unknown;
    deduped?: unknown;
    quarantined?: unknown;
    results?: unknown;
    errors?: unknown;
  };
  const hasCounts = typeof body.ingested === "number";
  const results = Array.isArray(body.results) ? (body.results as unknown[]) : null;
  if (!results && !hasCounts) {
    // 201 + ok:true but no counts and no results: not a recognisable ingest.
    return classifyFailure({ ...r, ok: false, status: r.status, body: { error: "malformed_response" } }, n);
  }
  const base = { httpStatus: r.status };
  if (results && results.length === n) {
    const outcomes = results.map((x): EventOutcome => {
      const o = x as { status?: unknown; error?: unknown } | null;
      if (o && typeof o.error === "string") {
        return { t: classifyReason(o.error), reason: o.error };
      }
      if (o?.status === "ingested") return { t: "ingested" };
      if (o?.status === "deduped") return { t: "deduped" };
      if (o?.status === "quarantined") return { t: "quarantined" };
      return { t: "retry", reason: "unrecognised_result" };
    });
    return { ...base, outcomes };
  }
  // Fallback (portal without `results`): derive from errors[] {idx, reason}.
  const outcomes: Array<EventOutcome | undefined> = new Array(n).fill(undefined);
  const errs = Array.isArray(body.errors) ? (body.errors as Array<{ idx?: unknown; reason?: unknown }>) : [];
  let listed = 0;
  for (const e of errs) {
    const idx = typeof e?.idx === "number" ? e.idx : typeof (e as { index?: unknown })?.index === "number" ? ((e as { index: number }).index) : -1;
    const reason = typeof e?.reason === "string" ? e.reason : "unknown_error";
    if (idx >= 0 && idx < n) {
      outcomes[idx] = { t: classifyReason(reason), reason };
      listed += 1;
    }
  }
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const accepted = num(body.ingested) + num(body.deduped) + num(body.quarantined);
  // errors[] is capped (50) by the portal: failures beyond the listed ones are
  // unidentifiable, so they are counted as retryable rather than assumed fine.
  let unaccounted = n - accepted - listed;
  const filled = outcomes.map((o): EventOutcome => {
    if (o) return o;
    if (unaccounted > 0) {
      unaccounted -= 1;
      return { t: "retry", reason: "unlisted_error" };
    }
    return { t: "ingested" };
  });
  return { ...base, outcomes: filled };
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Last batch send per clinic (the portal rate-limits per clinic). */
const lastBatchAt = new Map<string, number>();

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
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

async function pace(clinicId: string, paceMs: number, signal?: AbortSignal): Promise<void> {
  if (paceMs > 0) {
    const wait = (lastBatchAt.get(clinicId) ?? 0) + paceMs - Date.now();
    if (wait > 0) await abortableSleep(wait, signal);
  }
  lastBatchAt.set(clinicId, Date.now());
}

/** Test-only. */
export function _resetPortalClientState(): void {
  secretCache.clear();
  lastBatchAt.clear();
}

// ---------------------------------------------------------------------------
// postAll
// ---------------------------------------------------------------------------

export interface PostAllOptions {
  signal?: AbortSignal;
  /** Minimum ms between batch requests for this clinic (initial sync / poll
   *  pacing under the portal's 60 batches / 10 min per-clinic limit). 0 = none. */
  paceMs?: number;
}

export interface PostAllResult {
  ingested: number;
  deduped: number;
  quarantined: number;
  /** Events that must be RETRIED (they block the checkpoint). */
  errors: number;
  /** Events the portal permanently rejected; skipped, not retried. */
  skipped: number;
  skippedByReason: Record<string, number>;
  /** Events dropped by the pre-flight sanitiser (never sent). */
  dropped: number;
  droppedByReason: Record<string, number>;
  /** Human-readable cause of the blocking errors: HTTP status + reason(s). */
  failure?: string;
  /** Retry-After (ms) when the portal rate-limited us. */
  retryAfterMs?: number;
}

function bump(m: Record<string, number>, k: string, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}

/**
 * Sanitise, chunk and post `events`, returning per-event accounting. Stops at
 * the first whole-request failure (network/429/5xx/auth): the remaining events
 * are counted as retryable errors without being sent.
 */
export async function postAll(
  clinicId: string,
  events: CanonicalEvent[],
  opts: PostAllOptions = {}
): Promise<PostAllResult> {
  const clean = sanitizeEvents(events);
  const out: PostAllResult = {
    ingested: 0,
    deduped: 0,
    quarantined: 0,
    errors: 0,
    skipped: 0,
    skippedByReason: {},
    dropped: clean.dropped,
    droppedByReason: clean.droppedByReason,
  };
  const retryReasons: Record<string, number> = {};
  let lastStatus: number | undefined;
  let bisectBudget = BISECT_REQUEST_BUDGET;

  const apply = (o: EventOutcome) => {
    switch (o.t) {
      case "ingested":
        out.ingested += 1;
        break;
      case "deduped":
        out.deduped += 1;
        break;
      case "quarantined":
        out.quarantined += 1;
        break;
      case "skip":
        out.skipped += 1;
        bump(out.skippedByReason, o.reason);
        break;
      case "retry":
        out.errors += 1;
        bump(retryReasons, o.reason);
        break;
    }
  };

  /** Post one chunk; bisect on a whole-chunk shape rejection. */
  const postChunk = async (chunk: CanonicalEvent[], depth = 0): Promise<ChunkResult> => {
    let r: ChunkResult;
    // Requests spent below the first attempt count against the bisect budget.
    if (depth > 0) bisectBudget -= chunk.length < BATCH_THRESHOLD ? chunk.length : 1;
    if (chunk.length < BATCH_THRESHOLD) {
      const outcomes: EventOutcome[] = [];
      let stop = false;
      let retryAfterMs: number | undefined;
      for (const e of chunk) {
        if (stop) {
          outcomes.push({ t: "retry", reason: "not_sent_after_failure" });
          continue;
        }
        const one = interpretSingle(await postEvent(e, opts.signal));
        outcomes.push(...one.outcomes);
        stop = !!one.stop;
        lastStatus = one.httpStatus ?? lastStatus;
        retryAfterMs = one.retryAfterMs ?? retryAfterMs;
      }
      r = { outcomes, stop, retryAfterMs };
    } else {
      await pace(clinicId, opts.paceMs ?? 0, opts.signal);
      r = interpretBatch(await postBatch(clinicId, chunk, opts.signal), chunk.length);
    }
    lastStatus = r.httpStatus ?? lastStatus;
    if (r.bisect && chunk.length > 1 && bisectBudget > 0) {
      const mid = Math.ceil(chunk.length / 2);
      const left = await postChunk(chunk.slice(0, mid), depth + 1);
      const right = left.stop
        ? { outcomes: allOf(chunk.length - mid, { t: "retry", reason: "not_sent_after_failure" } as EventOutcome), stop: true }
        : await postChunk(chunk.slice(mid), depth + 1);
      return {
        outcomes: [...left.outcomes, ...right.outcomes],
        stop: left.stop || right.stop,
        retryAfterMs: left.retryAfterMs ?? right.retryAfterMs,
        httpStatus: right.httpStatus ?? left.httpStatus,
      };
    }
    if (r.bisect && chunk.length > 1) {
      // Bisect budget spent: do not skip a whole chunk on a guess. Retry later.
      return {
        ...r,
        bisect: false,
        outcomes: allOf(chunk.length, { t: "retry", reason: "chunk_rejected_unisolated" }),
      };
    }
    return r;
  };

  for (let i = 0; i < clean.events.length; i += POST_CHUNK) {
    const chunk = clean.events.slice(i, i + POST_CHUNK);
    const r = await postChunk(chunk);
    for (const o of r.outcomes) apply(o);
    if (r.retryAfterMs !== undefined) {
      out.retryAfterMs = Math.max(out.retryAfterMs ?? 0, r.retryAfterMs);
    }
    const anyAccepted = r.outcomes.some((o) => o.t !== "retry");
    if (r.stop || !anyAccepted) {
      // Whole-request failure (or nothing in this chunk was accepted): sending
      // the rest would only burn the rate limit. They are retryable, unsent.
      const rest = clean.events.length - (i + chunk.length);
      if (rest > 0) {
        out.errors += rest;
        bump(retryReasons, "not_sent_after_failure", rest);
      }
      break;
    }
  }

  if (out.errors > 0) {
    const unsent = retryReasons["not_sent_after_failure"] ?? 0;
    const parts = Object.entries(retryReasons)
      .filter(([k]) => k !== "not_sent_after_failure")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k} x${v}`);
    if (unsent > 0) parts.push(`${unsent} not sent`);
    out.failure = `${lastStatus !== undefined ? `http ${lastStatus}: ` : ""}${parts.join(", ")}`;
  }
  return out;
}
