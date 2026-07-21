import type { PvsLinkRow } from "../../db/client.js";
import { fetchWithTimeout } from "../../http.js";

/**
 * Consentz REST client wrapper.
 *
 * Consentz (https://www.consentz.com) is a UK-headquartered aesthetic
 * clinic management platform. Their public marketing surface lists their
 * AWS-hosted, ISO 27001 stack and clinic-grade audit trail; their
 * developer API is NOT publicly documented as of 2026-05-21.
 *
 * Section 11 verification (2026-05-21):
 *   - Consentz issues API credentials per Praxis on request to support.
 *     There is no self-serve developer portal as of verification date.
 *   - We default to a Bearer-token model (the dominant pattern for
 *     AWS-hosted clinic platforms; matches Pabau, Pabau OAuth, and the
 *     scoped tokens Consentz documents internally per Karam's vendor
 *     conversation log). If a Praxis returns with credentials that use a
 *     different scheme, the onboarding doc points them at this client
 *     and we widen the scheme list.
 *   - Endpoint paths below mirror the resource taxonomy in Consentz's
 *     public product pages: clients, appointments, treatment-notes,
 *     payments, recalls. Calibrate against the live API at first-Praxis
 *     onboarding; same disclaimer as the Tomedo adapter (header comment
 *     in apps/bridge/src/adapters/tomedo/client.ts).
 *   - The vendor-issued base URL is stored in
 *     connection_config.consentzEndpoint. We do NOT hardcode a default
 *     base URL because Consentz uses per-tenant endpoints.
 *
 * Build pattern matches the Tomedo + Pabau adapters so the scheduler can
 * treat all three Bucket B vendors interchangeably.
 */

const PAGE_SIZE = 100;
/** Upper bound on a single 429 back-off, so a bogus Retry-After can't park the
 *  sequential scheduler for hours. */
const MAX_RETRY_AFTER_MS = 5 * 60_000;
/** Cap on consecutive 429 retries for one request; on the cap we throw and let
 *  recordFailure back the link off instead of looping forever. */
const MAX_RETRIES = 5;

interface ConsentzConfig {
  endpoint: string;
  apiToken: string;
  /** Optional per-Praxis tenant id, sent as `X-Tenant-Id` header. Consentz
   *  multi-clinic accounts use this to scope reads to one clinic; for
   *  single-clinic accounts the header is ignored server-side. */
  tenantId?: string;
}

export interface ConsentzClient_Patient {
  id: string | number;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  notes?: string | null;
  updated_at: string;
}

export interface ConsentzAppointment {
  id: string | number;
  client_id: string | number;
  scheduled_at: string;
  status?: string | null;
  treatment_id?: string | number | null;
  treatment_name?: string | null;
  location_id?: string | number | null;
  location_name?: string | null;
  practitioner_name?: string | null;
  notes?: string | null;
  updated_at: string;
}

export interface ConsentzTreatmentNote {
  id: string | number;
  client_id: string | number;
  appointment_id?: string | number | null;
  treatment_id?: string | number | null;
  treatment_name?: string | null;
  practitioner_name?: string | null;
  completed_at: string;
  updated_at: string;
}

export interface ConsentzPayment {
  id: string | number;
  client_id: string | number;
  appointment_id?: string | number | null;
  treatment_note_id?: string | number | null;
  amount?: number | string | null;
  amount_cents?: number | null;
  currency?: string | null;
  paid_at?: string | null;
  status?: string | null;
  updated_at: string;
}

export interface ConsentzRecall {
  id: string | number;
  client_id: string | number;
  recall_at: string;
  treatment_id?: string | number | null;
  treatment_name?: string | null;
  updated_at: string;
}

interface PageEnvelope<T> {
  /** Consentz wraps list responses under "data" per their internal docs;
   *  we also accept "items" for forward compatibility. */
  data?: T[];
  items?: T[];
  total?: number;
  page?: number;
  per_page?: number;
}

export class ConsentzClient {
  constructor(private readonly cfg: ConsentzConfig) {}

  static from(link: PvsLinkRow): ConsentzClient {
    const cfg = link.connectionConfig as {
      consentzEndpoint?: string;
      consentzApiToken?: string;
      consentzTenantId?: string;
    };
    if (!cfg.consentzEndpoint || !cfg.consentzApiToken) {
      throw new Error(
        "consentz: connection_config missing consentzEndpoint or consentzApiToken"
      );
    }
    return new ConsentzClient({
      endpoint: cfg.consentzEndpoint.replace(/\/$/, ""),
      apiToken: cfg.consentzApiToken,
      tenantId: cfg.consentzTenantId,
    });
  }

  async healthCheck(): Promise<void> {
    // Consentz exposes `/health` (some tenants) and `/me` (most tenants).
    // We try /health first because /me may require an audit-log scope
    // the Praxis hasn't granted. Fall back to a single-row clients
    // probe which every tenant supports.
    const a = await this.get("/health");
    if (a.ok) return;
    const b = await this.get("/me");
    if (b.ok) return;
    const c = await this.get(`/clients?per_page=1&page=1`);
    if (!c.ok) {
      throw new Error(`consentz health ${a.status}/${b.status}/${c.status}`);
    }
  }

  streamPatients(modifiedSince: string): AsyncIterable<ConsentzClient_Patient> {
    return this.paginate<ConsentzClient_Patient>("/clients", modifiedSince);
  }
  streamAppointments(modifiedSince: string): AsyncIterable<ConsentzAppointment> {
    return this.paginate<ConsentzAppointment>("/appointments", modifiedSince);
  }
  streamEncounters(
    modifiedSince: string
  ): AsyncIterable<ConsentzTreatmentNote> {
    return this.paginate<ConsentzTreatmentNote>(
      "/treatment-notes",
      modifiedSince
    );
  }
  streamPayments(modifiedSince: string): AsyncIterable<ConsentzPayment> {
    return this.paginate<ConsentzPayment>("/payments", modifiedSince);
  }
  streamRecalls(modifiedSince: string): AsyncIterable<ConsentzRecall> {
    return this.paginate<ConsentzRecall>("/recalls", modifiedSince);
  }

  // ---- internals ----

  private async get(pathAndQuery: string): Promise<Response> {
    const url = `${this.cfg.endpoint}${pathAndQuery}`;
    let retries = 0;
    for (;;) {
      const res = await fetchWithTimeout(url, { headers: this.authHeaders() });
      if (res.status !== 429) return res;
      if (retries >= MAX_RETRIES) {
        throw new Error(
          `consentz GET ${pathAndQuery} rate-limited: exceeded ${MAX_RETRIES} retries`
        );
      }
      retries += 1;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      await sleep(retryAfter);
    }
  }

  private async *paginate<T>(
    path: string,
    modifiedSince: string
  ): AsyncIterable<T> {
    let page = 1;
    for (;;) {
      const q =
        `${path}?updated_since=${encodeURIComponent(modifiedSince)}` +
        `&per_page=${PAGE_SIZE}&page=${page}`;
      const res = await this.get(q);
      if (!res.ok) {
        throw new Error(
          `consentz GET ${path} page=${page} ${res.status}: ${await safeText(res)}`
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
          `consentz GET ${path} page=${page} ${res.status}: response envelope missing 'data'/'items' array: ${truncate(
            JSON.stringify(body)
          )}`
        );
      }
      for (const item of items) yield item;
      // H17: stop on an EMPTY page, not on a short one. A server that clamps
      // per_page returns a "short" page that is not the end; the old
      // `< PAGE_SIZE` check dropped everything after it. Page-number paging
      // stays consistent under a clamp, so page until an empty page. The
      // result set can mutate between requests; poll overlap plus portal-side
      // dedup absorb that window.
      if (items.length === 0) return;
      page += 1;
    }
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.cfg.apiToken}`,
    };
    if (this.cfg.tenantId) h["x-tenant-id"] = this.cfg.tenantId;
    return h;
  }
}

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
