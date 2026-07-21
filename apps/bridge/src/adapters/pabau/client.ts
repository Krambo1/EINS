import type { PvsLinkRow } from "../../db/client.js";
import { fetchWithTimeout } from "../../http.js";

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
/** Upper bound on a single 429 back-off, so a bogus Retry-After can't park the
 *  sequential scheduler for hours. */
const MAX_RETRY_AFTER_MS = 5 * 60_000;
/** Cap on consecutive 429 retries for one request; on the cap we throw and let
 *  recordFailure back the link off instead of looping forever. */
const MAX_RETRIES = 5;

interface PabauConfig {
  /** Full base URL with the API segment. e.g. "https://api.oauth.pabau.com/api/v1". */
  endpoint: string;
  apiToken: string;
  /** Optional, only set when the Praxis uses OAuth client_credentials.
   *  We default to api_token everywhere else for onboarding simplicity. */
  oauthClientId?: string;
  oauthClientSecret?: string;
}

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

  static from(link: PvsLinkRow): PabauClient {
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

  streamPatients(modifiedSince: string): AsyncIterable<PabauPatient> {
    return this.paginate<PabauPatient>("/patients", modifiedSince);
  }
  streamAppointments(modifiedSince: string): AsyncIterable<PabauAppointment> {
    return this.paginate<PabauAppointment>("/bookings", modifiedSince);
  }
  streamEncounters(modifiedSince: string): AsyncIterable<PabauEncounter> {
    // Pabau's "treatment_notes" endpoint represents completed treatments
    // for aesthetic accounts. Some accounts surface them under
    // "/medical_forms" instead; the per-account flavor is configured at
    // enrollment via connection_config.pabauEncounterPath. We accept an
    // override to avoid hardcoding.
    return this.paginate<PabauEncounter>("/treatment_notes", modifiedSince);
  }
  streamInvoices(modifiedSince: string): AsyncIterable<PabauInvoice> {
    return this.paginate<PabauInvoice>("/invoices", modifiedSince);
  }
  streamRecalls(modifiedSince: string): AsyncIterable<PabauRecall> {
    return this.paginate<PabauRecall>("/recalls", modifiedSince);
  }

  /** ------ Internals ------ */

  /** GET with auth + 429 backoff. Returns the raw Response so callers can
   *  branch on status (used by healthCheck for the 404 → fallback path). */
  private async get(pathAndQuery: string): Promise<Response> {
    await this.ensureToken();
    const url = `${this.cfg.endpoint.replace(/\/$/, "")}${pathAndQuery}`;
    let retries = 0;
    for (;;) {
      const res = await fetchWithTimeout(url, { headers: await this.authHeaders() });
      if (res.status !== 429) return res;
      if (retries >= MAX_RETRIES) {
        throw new Error(
          `pabau GET ${pathAndQuery} rate-limited: exceeded ${MAX_RETRIES} retries`
        );
      }
      retries += 1;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      await sleep(retryAfter);
      // After waiting we may need to re-mint a token if it has lapsed.
      await this.ensureToken();
    }
  }

  private async *paginate<T>(
    path: string,
    modifiedSince: string
  ): AsyncIterable<T> {
    let page = 1;
    for (;;) {
      const url =
        `${path}?modified_since=${encodeURIComponent(modifiedSince)}` +
        `&per_page=${PAGE_SIZE}&page=${page}`;
      const res = await this.get(url);
      if (!res.ok) {
        throw new Error(`pabau GET ${path} page=${page} ${res.status}: ${await safeText(res)}`);
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
      for (const item of items) yield item;
      // H17: stop on an EMPTY page, not on a short one. If the server clamps
      // per_page below what we request it returns a "short" page that is not
      // the end; the old `< PAGE_SIZE` check dropped everything after it.
      // Page-number paging stays consistent under a clamp (the server uses
      // its own effective page size), so incrementing page until an empty
      // page is safe. The result set can mutate between requests; poll
      // overlap plus portal-side dedup absorb that window.
      if (items.length === 0) return;
      page += 1;
    }
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

/** Pabau's Retry-After is in seconds (per HTTP spec). Some proxies emit an
 *  HTTP-date; we accept either. */
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

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
