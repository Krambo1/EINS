import type { PvsLinkRow } from "../../db/client.js";
import { fetchWithTimeout } from "../../http.js";

/**
 * Tomedo REST client wrapper.
 *
 * The Tomedo cloud API requires:
 *   • a tenant endpoint URL (e.g. https://tenant-foo.tomedo.de/api/v1)
 *   • OAuth2 client_credentials with clientId + clientSecret
 *
 * Both are stored in pvs_link.connection_config; the secret half is
 * encrypted in platform_credentials and decrypted at startup via the
 * shared APP_KEY.
 *
 * NOTE: The exact endpoint paths below mirror Zollsoft's published
 * documentation surface as of writing. Calibrate against the sandbox
 * before turning a clinic live. Methods are streaming (AsyncIterables)
 * so initial-sync over 50k appointments doesn't buffer in memory.
 */

const PAGE_SIZE = 500;
/** Upper bound on a single 429 back-off. A bogus Retry-After (an HTTP-date
 *  far in the future, or a huge delta) must not park the sequential scheduler
 *  for hours. */
const MAX_RETRY_AFTER_MS = 5 * 60_000;
/** Per-page cap on consecutive 429 retries. Without it a server that answers
 *  429 forever (or a Retry-After that never clears) blocks the whole scheduler
 *  on one link. On the cap we throw; recordFailure then backs the link off. */
const MAX_RETRIES = 5;

interface TomedoConfig {
  endpoint: string;
  clientId: string;
  clientSecret: string;
}

interface RawRecord {
  modifiedAt: string;
  [k: string]: unknown;
}

export class TomedoClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly cfg: TomedoConfig) {}

  static from(link: PvsLinkRow): TomedoClient {
    const cfg = link.connectionConfig as {
      tomedoEndpoint?: string;
      tomedoClientId?: string;
      tomedoClientSecret?: string;
    };
    if (!cfg.tomedoEndpoint || !cfg.tomedoClientId || !cfg.tomedoClientSecret) {
      throw new Error("tomedo: incomplete connection_config");
    }
    return new TomedoClient({
      endpoint: cfg.tomedoEndpoint,
      clientId: cfg.tomedoClientId,
      clientSecret: cfg.tomedoClientSecret,
    });
  }

  async healthCheck(): Promise<void> {
    await this.ensureToken();
    const url = `${this.cfg.endpoint.replace(/\/$/, "")}/meta/health`;
    const res = await fetchWithTimeout(url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`tomedo health ${res.status}`);
  }

  private async ensureToken(): Promise<void> {
    if (
      this.accessToken &&
      this.accessTokenExpiresAt > Date.now() + 60_000
    ) {
      return;
    }
    const tokenUrl = `${this.cfg.endpoint.replace(/\/$/, "")}/oauth/token`;
    const res = await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`tomedo oauth ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
  }

  // ----- paginated GET helpers --------------------------------------

  private async *paginate(
    path: string,
    modifiedSince: string
  ): AsyncIterable<RawRecord> {
    let offset = 0;
    let retries = 0;
    for (;;) {
      await this.ensureToken();
      const url =
        `${this.cfg.endpoint.replace(/\/$/, "")}${path}` +
        `?modifiedSince=${encodeURIComponent(modifiedSince)}` +
        `&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetchWithTimeout(url, {
        headers: { authorization: `Bearer ${this.accessToken}` },
      });
      if (res.status === 429) {
        // Retry-After is either delta-seconds or an HTTP-date; Number() on a
        // date is NaN → sleep(NaN) → hot loop. Parse both, clamp, and cap the
        // retry count so a stuck rate limit can't block the scheduler.
        if (retries >= MAX_RETRIES) {
          throw new Error(
            `tomedo GET ${path} rate-limited: exceeded ${MAX_RETRIES} retries`
          );
        }
        retries += 1;
        await sleep(parseRetryAfter(res.headers.get("retry-after")));
        continue;
      }
      retries = 0;
      if (!res.ok) {
        throw new Error(`tomedo GET ${path} ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as { items?: RawRecord[]; total?: number };
      // A 200 whose body lacks the `items` array is an error envelope (auth
      // notice, deprecation, changed shape), NOT a healthy empty page. Treating
      // it as `[]` would silently and permanently mark the stream drained. Fail
      // loudly instead so recordFailure backs the link off and it is visible.
      if (!Array.isArray(data.items)) {
        throw new Error(
          `tomedo GET ${path} ${res.status}: response envelope missing 'items' array: ${truncate(
            JSON.stringify(data)
          )}`
        );
      }
      const items = data.items;
      for (const item of items) yield item;
      // H17: terminate on an EMPTY page, not on a short one. A server that
      // clamps limit=500 to 100 returns a "short" full-of-rows page; the old
      // `< PAGE_SIZE` check treated that as the end and silently dropped
      // everything after page 1. Advance the offset by the number of rows we
      // actually received (not by the requested PAGE_SIZE) so a clamp cannot
      // skip a window of rows, and keep paging until a truly empty page.
      // The result set can mutate between requests (offset paging shifts rows
      // across page boundaries); the poll overlap plus portal-side dedup
      // absorb that window.
      if (items.length === 0) return;
      offset += items.length;
    }
  }

  streamPatients(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.paginate("/patients", modifiedSince);
  }
  streamAppointments(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.paginate("/appointments", modifiedSince);
  }
  streamEncounters(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.paginate("/encounters", modifiedSince);
  }
  streamInvoices(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.paginate("/invoices", modifiedSince);
  }
  streamRecalls(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.paginate("/recalls", modifiedSince);
  }
}

/** Tomedo's Retry-After is delta-seconds per HTTP spec, but a proxy may emit
 *  an HTTP-date. Accept either, clamp to MAX_RETRY_AFTER_MS, and never return
 *  NaN/0 (which would spin the retry loop). */
function parseRetryAfter(raw: string | null): number {
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

/** Cap a string for safe inclusion in an error/log line. */
function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
