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
 * Pabau REST client wrapper.
 *
 * Pabau (https://pabau.com) is a UK-anchored cloud PVS used by aesthetic
 * clinics; DACH adoption is a smaller but real slice of the EINS Bucket B
 * surface. The API is publicly documented (support.pabau.com/en/api) and
 * exposes both an `api_token` model and OAuth2 client_credentials.
 *
 * Section 11 verification (2026-05-21):
 *   - Per-Praxis api_token, NOT a single shared developer credential.
 *     Each Praxis generates their own token in Pabau Setup → Developer
 *     & Other → Private Apps → Edit and hands it to EINS during
 *     onboarding. No partner-program membership required.
 *   - Rate limits are company-wide:
 *       110 req/min (standard accounts), 25k/day
 *       190 req/min (Enterprise/Group/Bespoke), 50k/day
 *     We hold one token per Praxis so the limit is effectively per-Praxis
 *     for our load.
 *   - POST/PUT daily fair-usage cap is 10k/user/day. Read-only flow, so
 *     non-binding.
 *   - Rate-limit overage returns HTTP 429; we honor `Retry-After`.
 *   - Base URL: https://api.oauth.pabau.com/{api}/ (the `{api}` segment
 *     identifies the Pabau app the token authorizes; stored in
 *     connection_config.pabauApiPath, e.g. "api/v1"). We accept either a
 *     full base URL via pabauEndpoint OR fall back to constructing one.
 *
 * The Pabau docs (support.pabau.com/en/api/list-appointments etc.) are
 * cloudflare-gated against unauthenticated fetchers; the exact field shape
 * below mirrors their published response envelope as of the verification
 * date. Calibrate against the live API before turning a Praxis live, same
 * as we do for Tomedo.
 *
 * Cursor model: Pabau's list endpoints support a `modified_since` ISO
 * timestamp filter on the resources we care about. We page with
 * `page=N&per_page=PAGE_SIZE` (Pabau's documented pagination).
 */

const PAGE_SIZE = 100;
const DEFAULT_API_PATH = "api/v1";
const DEFAULT_BASE = "https://api.oauth.pabau.com";

interface PabauConfig {
  /** Full base URL with the API segment. e.g. "https://api.oauth.pabau.com/api/v1". */
  endpoint: string;
  apiToken: string;
  /** Optional, only set when the Praxis uses OAuth client_credentials.
   *  We default to api_token everywhere else for onboarding simplicity. */
  oauthClientId?: string;
  oauthClientSecret?: string;
  /** Aborts every in-flight request and back-off sleep (scheduler deadline). */
  signal?: AbortSignal;
}

export type PabauStream = "patients" | "appointments" | "encounters" | "invoices" | "recalls";

const STREAM_PATHS: Record<PabauStream, string> = {
  patients: "/patients",
  appointments: "/bookings",
  // Pabau's "treatment_notes" endpoint represents completed treatments for
  // aesthetic accounts (some accounts surface them under "/medical_forms").
  encounters: "/treatment_notes",
  invoices: "/invoices",
  recalls: "/recalls",
};

export interface PabauPatient {
  id: string | number;
  email?: string | null;
  mobile?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  dob?: string | null;
  gender?: string | null;
  notes?: string | null;
  modified_at: string;
}

export interface PabauAppointment {
  id: string | number;
  client_id: string | number;
  start_time: string;
  end_time?: string | null;
  status?: string | null;
  service_id?: string | number | null;
  service_name?: string | null;
  location_id?: string | number | null;
  location_name?: string | null;
  notes?: string | null;
  modified_at: string;
}

export interface PabauEncounter {
  /** Pabau models completed treatments as "treatment_notes" or
   *  "completed_bookings" depending on the account configuration. We accept
   *  either via the same shape; the normalizer maps both. */
  id: string | number;
  client_id: string | number;
  booking_id?: string | number | null;
  service_id?: string | number | null;
  service_name?: string | null;
  practitioner_name?: string | null;
  completed_at: string;
  modified_at: string;
}

export interface PabauInvoice {
  id: string | number;
  client_id: string | number;
  booking_id?: string | number | null;
  treatment_note_id?: string | number | null;
  total?: number | string | null;
  total_amount?: number | string | null;
  amount_cents?: number | null;
  currency?: string | null;
  paid_at?: string | null;
  status?: string | null;
  /** On a credit note: the invoice it belongs to. Pabau accounts name this
   *  differently, the normalizer accepts the common spellings. */
  parent_invoice_id?: string | number | null;
  original_invoice_id?: string | number | null;
  credit_note_for?: string | number | null;
  modified_at: string;
}

export interface PabauRecall {
  id: string | number;
  client_id: string | number;
  recall_at: string;
  service_id?: string | number | null;
  service_name?: string | null;
  modified_at: string;
}

interface PageEnvelope<T> {
  /** Pabau returns either `data: T[]` or `items: T[]` depending on endpoint.
   *  We accept both. */
  data?: T[];
  items?: T[];
  /** Total count, when present. We don't depend on it; we paginate until
   *  the page comes back smaller than PAGE_SIZE. */
  total?: number;
  page?: number;
  per_page?: number;
}

export class PabauClient {
  private oauthToken: string | null = null;
  private oauthExpiresAt = 0;

  constructor(private readonly cfg: PabauConfig) {}

  static from(link: PvsLinkRow, opts: { signal?: AbortSignal } = {}): PabauClient {
    const cfg = link.connectionConfig as {
      pabauEndpoint?: string;
      pabauApiPath?: string;
      pabauApiToken?: string;
      pabauClientId?: string;
      pabauClientSecret?: string;
    };
    const apiPath = (cfg.pabauApiPath ?? DEFAULT_API_PATH).replace(/^\/|\/$/g, "");
    const endpoint =
      cfg.pabauEndpoint?.replace(/\/$/, "") ?? `${DEFAULT_BASE}/${apiPath}`;
    if (!cfg.pabauApiToken && !(cfg.pabauClientId && cfg.pabauClientSecret)) {
      throw new Error(
        "pabau: connection_config missing pabauApiToken or pabauClientId+pabauClientSecret"
      );
    }
    return new PabauClient({
      endpoint,
      apiToken: cfg.pabauApiToken ?? "",
      oauthClientId: cfg.pabauClientId,
      oauthClientSecret: cfg.pabauClientSecret,
      signal: opts.signal,
    });
  }

  async healthCheck(): Promise<void> {
    // Pabau exposes a lightweight `/me` (or `/account`) endpoint that
    // returns the authenticated account profile. We try `/me` first;
    // if the account-app doesn't expose it, we fall back to a 1-row
    // list-patients probe which every Pabau install supports.
    const res = await this.get("/me");
    if (res.status === 404) {
      const probe = await this.get(`/patients?per_page=1&page=1`);
      if (!probe.ok) {
        throw new Error(`pabau health probe ${probe.status}`);
      }
      return;
    }
    if (!res.ok) {
      throw new Error(`pabau health ${res.status}`);
    }
  }

  /** ------ Streams: one async iterable per resource. ------ */

  /** Pages of one stream (bounded, abortable, resumable by page number). */
  pages<T = unknown>(
    stream: PabauStream,
    modifiedSince: string,
    opts: PageOptions = {}
  ): AsyncIterable<Page<T>> {
    return this.paginate<T>(STREAM_PATHS[stream], modifiedSince, opts);
  }

  streamPatients(modifiedSince: string): AsyncIterable<PabauPatient> {
    return this.flatten<PabauPatient>("patients", modifiedSince);
  }
  streamAppointments(modifiedSince: string): AsyncIterable<PabauAppointment> {
    return this.flatten<PabauAppointment>("appointments", modifiedSince);
  }
  streamEncounters(modifiedSince: string): AsyncIterable<PabauEncounter> {
    return this.flatten<PabauEncounter>("encounters", modifiedSince);
  }
  streamInvoices(modifiedSince: string): AsyncIterable<PabauInvoice> {
    return this.flatten<PabauInvoice>("invoices", modifiedSince);
  }
  streamRecalls(modifiedSince: string): AsyncIterable<PabauRecall> {
    return this.flatten<PabauRecall>("recalls", modifiedSince);
  }

  private async *flatten<T>(stream: PabauStream, modifiedSince: string): AsyncIterable<T> {
    for await (const page of this.pages<T>(stream, modifiedSince, {
      maxPages: Number.POSITIVE_INFINITY,
    })) {
      for (const row of page.rows) yield row;
    }
  }

  /** ------ Internals ------ */

  /** GET with auth + 429 backoff. Returns the raw Response so callers can
   *  branch on status (used by healthCheck for the 404 → fallback path). */
  private async get(pathAndQuery: string): Promise<Response> {
    await this.ensureToken();
    const url = `${this.cfg.endpoint.replace(/\/$/, "")}${pathAndQuery}`;
    let retries = 0;
    for (;;) {
      const res = await fetchWithTimeout(url, {
        headers: await this.authHeaders(),
        signal: this.cfg.signal,
      });
      if (res.status !== 429) return res;
      if (retries >= MAX_RETRIES) {
        throw new Error(
          `pabau GET ${pathAndQuery} rate-limited: exceeded ${MAX_RETRIES} retries`
        );
      }
      retries += 1;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      await abortableSleep(retryAfter, this.cfg.signal);
      // After waiting we may need to re-mint a token if it has lapsed.
      await this.ensureToken();
    }
  }

  private paginate<T>(
    path: string,
    modifiedSince: string,
    opts: PageOptions = {}
  ): AsyncIterable<Page<T>> {
    return walkPages<T>({
      label: `pabau GET ${path}`,
      startAt: opts.startAt ?? 1,
      maxPages: opts.maxPages ?? Number.POSITIVE_INFINITY,
      signal: opts.signal ?? this.cfg.signal,
      // Page-number paging stays consistent under a server-side page-size clamp
      // (the server uses its own effective size), so the position is simply
      // page+1 until an empty page. The result set can mutate between requests;
      // poll overlap plus portal-side dedup absorb that window.
      advance: (at) => at + 1,
      fetchPage: async (page) => {
        const url =
          `${path}?modified_since=${encodeURIComponent(modifiedSince)}` +
          `&per_page=${PAGE_SIZE}&page=${page}`;
        const res = await this.get(url);
        if (!res.ok) {
          throw new VendorHttpError(
            `pabau GET ${path} page=${page} ${res.status}: ${await safeText(res)}`,
            res.status
          );
        }
        const body = (await res.json()) as PageEnvelope<T>;
        // A 200 whose body carries neither a `data` nor an `items` array is an
        // error envelope (changed shape, auth notice), NOT a healthy empty page.
        // Treating it as `[]` would silently mark the stream permanently drained,
        // the likeliest onboarding silent-death mode. Fail loudly instead.
        const items = Array.isArray(body.data)
          ? body.data
          : Array.isArray(body.items)
            ? body.items
            : null;
        if (items === null) {
          throw new Error(
            `pabau GET ${path} page=${page} ${res.status}: response envelope missing 'data'/'items' array: ${truncate(
              JSON.stringify(body)
            )}`
          );
        }
        return items;
      },
    });
  }

  private async ensureToken(): Promise<void> {
    // api_token mode: nothing to refresh; the token is the credential.
    if (this.cfg.apiToken) return;
    // OAuth client_credentials mode.
    if (!this.cfg.oauthClientId || !this.cfg.oauthClientSecret) {
      throw new Error("pabau: no credential material");
    }
    if (this.oauthToken && this.oauthExpiresAt > Date.now() + 60_000) return;
    const tokenUrl = `${this.cfg.endpoint.replace(/\/$/, "")}/oauth/token`;
    const res = await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.cfg.oauthClientId,
        client_secret: this.cfg.oauthClientSecret,
      }),
      signal: this.cfg.signal,
    });
    if (!res.ok) {
      throw new Error(`pabau oauth ${res.status}: ${await safeText(res)}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.oauthToken = data.access_token;
    this.oauthExpiresAt = Date.now() + data.expires_in * 1000;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.cfg.apiToken) {
      // Pabau's documented header for api_token mode.
      return {
        accept: "application/json",
        authorization: `Bearer ${this.cfg.apiToken}`,
      };
    }
    if (this.oauthToken) {
      return {
        accept: "application/json",
        authorization: `Bearer ${this.oauthToken}`,
      };
    }
    throw new Error("pabau: no token available");
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
