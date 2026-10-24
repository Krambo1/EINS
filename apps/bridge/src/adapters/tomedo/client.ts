import type { PvsLinkRow } from "../../db/client.js";
import { fetchWithTimeout } from "../../http.js";
import {
  MAX_RETRIES,
  abortableSleep,
  parseRetryAfter,
  truncateText as truncate,
  VendorHttpError,
  walkPages,
  type Page,
  type PageOptions,
} from "../_shared/paging.js";

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

interface TomedoConfig {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  /** Aborts every in-flight request and back-off sleep (scheduler deadline). */
  signal?: AbortSignal;
}

export type TomedoStream = "patients" | "appointments" | "encounters" | "invoices" | "recalls";

const STREAM_PATHS: Record<TomedoStream, string> = {
  patients: "/patients",
  appointments: "/appointments",
  encounters: "/encounters",
  invoices: "/invoices",
  recalls: "/recalls",
};

interface RawRecord {
  modifiedAt: string;
  [k: string]: unknown;
}

export class TomedoClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly cfg: TomedoConfig) {}

  static from(link: PvsLinkRow, opts: { signal?: AbortSignal } = {}): TomedoClient {
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
      signal: opts.signal,
    });
  }

  async healthCheck(): Promise<void> {
    await this.ensureToken();
    const url = `${this.cfg.endpoint.replace(/\/$/, "")}/meta/health`;
    const res = await fetchWithTimeout(url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
      signal: this.cfg.signal,
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
      signal: this.cfg.signal,
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

  private paginate(
    path: string,
    modifiedSince: string,
    opts: PageOptions = {}
  ): AsyncIterable<Page<RawRecord>> {
    let retries = 0;
    return walkPages<RawRecord>({
      label: `tomedo GET ${path}`,
      startAt: opts.startAt ?? 0,
      maxPages: opts.maxPages ?? Number.POSITIVE_INFINITY,
      signal: opts.signal ?? this.cfg.signal,
      // H17: terminate on an EMPTY page, not on a short one. A server that
      // clamps limit=500 to 100 returns a "short" full-of-rows page. Advance the
      // offset by the number of rows we actually received (not by the requested
      // PAGE_SIZE) so a clamp cannot skip a window of rows. The result set can
      // mutate between requests (offset paging shifts rows across page
      // boundaries); the poll overlap plus portal-side dedup absorb that window.
      advance: (at, rows) => at + rows.length,
      fetchPage: async (offset) => {
        for (;;) {
          await this.ensureToken();
          const url =
            `${this.cfg.endpoint.replace(/\/$/, "")}${path}` +
            `?modifiedSince=${encodeURIComponent(modifiedSince)}` +
            `&limit=${PAGE_SIZE}&offset=${offset}`;
          const res = await fetchWithTimeout(url, {
            headers: { authorization: `Bearer ${this.accessToken}` },
            signal: this.cfg.signal,
          });
          if (res.status === 429) {
            // Retry-After is either delta-seconds or an HTTP-date: parse both,
            // clamp, and cap the retry count so a stuck rate limit can not pin a
            // worker.
            if (retries >= MAX_RETRIES) {
              throw new Error(
                `tomedo GET ${path} rate-limited: exceeded ${MAX_RETRIES} retries`
              );
            }
            retries += 1;
            await abortableSleep(parseRetryAfter(res.headers.get("retry-after")), this.cfg.signal);
            continue;
          }
          retries = 0;
          if (!res.ok) {
            throw new VendorHttpError(
              `tomedo GET ${path} ${res.status}: ${await res.text()}`,
              res.status
            );
          }
          const data = (await res.json()) as { items?: RawRecord[]; total?: number };
          // A 200 whose body lacks the `items` array is an error envelope (auth
          // notice, deprecation, changed shape), NOT a healthy empty page.
          // Treating it as `[]` would silently and permanently mark the stream
          // drained. Fail loudly so recordFailure backs the link off.
          if (!Array.isArray(data.items)) {
            throw new Error(
              `tomedo GET ${path} ${res.status}: response envelope missing 'items' array: ${truncate(
                JSON.stringify(data)
              )}`
            );
          }
          return data.items;
        }
      },
    });
  }

  /** Pages of one stream (bounded, abortable, resumable by offset). */
  pages(
    stream: TomedoStream,
    modifiedSince: string,
    opts: PageOptions = {}
  ): AsyncIterable<Page<RawRecord>> {
    return this.paginate(STREAM_PATHS[stream], modifiedSince, opts);
  }

  private async *flatten(stream: TomedoStream, modifiedSince: string): AsyncIterable<RawRecord> {
    for await (const page of this.pages(stream, modifiedSince, {
      maxPages: Number.POSITIVE_INFINITY,
    })) {
      for (const row of page.rows) yield row;
    }
  }

  streamPatients(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.flatten("patients", modifiedSince);
  }
  streamAppointments(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.flatten("appointments", modifiedSince);
  }
  streamEncounters(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.flatten("encounters", modifiedSince);
  }
  streamInvoices(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.flatten("invoices", modifiedSince);
  }
  streamRecalls(modifiedSince: string): AsyncIterable<RawRecord> {
    return this.flatten("recalls", modifiedSince);
  }
}
