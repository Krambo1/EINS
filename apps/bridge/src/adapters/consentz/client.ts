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

interface ConsentzConfig {
  endpoint: string;
  apiToken: string;
  /** Optional per-Praxis tenant id, sent as `X-Tenant-Id` header. Consentz
   *  multi-clinic accounts use this to scope reads to one clinic; for
   *  single-clinic accounts the header is ignored server-side. */
  tenantId?: string;
  /** Aborts every in-flight request and back-off sleep (scheduler deadline). */
  signal?: AbortSignal;
}

export type ConsentzStream = "patients" | "appointments" | "encounters" | "payments" | "recalls";

const STREAM_PATHS: Record<ConsentzStream, string> = {
  patients: "/clients",
  appointments: "/appointments",
  encounters: "/treatment-notes",
  payments: "/payments",
  recalls: "/recalls",
};

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
  /** On a refund: the payment it belongs to (accepted spellings, see the normalizer). */
  parent_payment_id?: string | number | null;
  original_payment_id?: string | number | null;
  refund_of?: string | number | null;
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

  static from(link: PvsLinkRow, opts: { signal?: AbortSignal } = {}): ConsentzClient {
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
      signal: opts.signal,
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

  /** Pages of one stream (bounded, abortable, resumable by page number). */
  pages<T = unknown>(
    stream: ConsentzStream,
    modifiedSince: string,
    opts: PageOptions = {}
  ): AsyncIterable<Page<T>> {
    return this.paginate<T>(STREAM_PATHS[stream], modifiedSince, opts);
  }

  streamPatients(modifiedSince: string): AsyncIterable<ConsentzClient_Patient> {
    return this.flatten<ConsentzClient_Patient>("patients", modifiedSince);
  }
  streamAppointments(modifiedSince: string): AsyncIterable<ConsentzAppointment> {
    return this.flatten<ConsentzAppointment>("appointments", modifiedSince);
  }
  streamEncounters(
    modifiedSince: string
  ): AsyncIterable<ConsentzTreatmentNote> {
    return this.flatten<ConsentzTreatmentNote>("encounters", modifiedSince);
  }
  streamPayments(modifiedSince: string): AsyncIterable<ConsentzPayment> {
    return this.flatten<ConsentzPayment>("payments", modifiedSince);
  }
  streamRecalls(modifiedSince: string): AsyncIterable<ConsentzRecall> {
    return this.flatten<ConsentzRecall>("recalls", modifiedSince);
  }

  private async *flatten<T>(stream: ConsentzStream, modifiedSince: string): AsyncIterable<T> {
    for await (const page of this.pages<T>(stream, modifiedSince, {
      maxPages: Number.POSITIVE_INFINITY,
    })) {
      for (const row of page.rows) yield row;
    }
  }

  // ---- internals ----

  private async get(pathAndQuery: string): Promise<Response> {
    const url = `${this.cfg.endpoint}${pathAndQuery}`;
    let retries = 0;
    for (;;) {
      const res = await fetchWithTimeout(url, {
        headers: this.authHeaders(),
        signal: this.cfg.signal,
      });
      if (res.status !== 429) return res;
      if (retries >= MAX_RETRIES) {
        throw new Error(
          `consentz GET ${pathAndQuery} rate-limited: exceeded ${MAX_RETRIES} retries`
        );
      }
      retries += 1;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      await abortableSleep(retryAfter, this.cfg.signal);
    }
  }

  private paginate<T>(
    path: string,
    modifiedSince: string,
    opts: PageOptions = {}
  ): AsyncIterable<Page<T>> {
    return walkPages<T>({
      label: `consentz GET ${path}`,
      startAt: opts.startAt ?? 1,
      maxPages: opts.maxPages ?? Number.POSITIVE_INFINITY,
      signal: opts.signal ?? this.cfg.signal,
      // H17: page until an EMPTY page (a clamped per_page returns a "short" page
      // that is not the end). The result set can mutate between requests; poll
      // overlap plus portal-side dedup absorb that window.
      advance: (at) => at + 1,
      fetchPage: async (page) => {
        const q =
          `${path}?updated_since=${encodeURIComponent(modifiedSince)}` +
          `&per_page=${PAGE_SIZE}&page=${page}`;
        const res = await this.get(q);
        if (!res.ok) {
          throw new VendorHttpError(
            `consentz GET ${path} page=${page} ${res.status}: ${await safeText(res)}`,
            res.status
          );
        }
        const body = (await res.json()) as PageEnvelope<T>;
        // A 200 whose body carries neither a `data` nor an `items` array is an
        // error envelope (changed shape, auth notice), NOT a healthy empty page.
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
        return items;
      },
    });
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

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
