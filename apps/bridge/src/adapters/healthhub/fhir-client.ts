import type { PvsLinkRow } from "../../db/client.js";
import type { FhirBundle } from "../_fhir/normalize-shared.js";
import { fetchWithTimeout } from "../../http.js";

/**
 * Thin FHIR client for medatixx HealthHub.
 *
 * Authentication: OAuth2 client_credentials against the HealthHub
 * tenant's OAuth server. medatixx issues these credentials only after
 * akkreditierung.
 *
 * Required FHIR R4 resources subscribed:
 *   Patient, Appointment, Encounter, Invoice
 *
 * The `searchAll` generator walks `?_lastUpdated=gt{sinceIso}&_count=200`
 * for each resource type, yielding pages until the server returns
 * `next` link == null.
 */
interface HealthHubConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

const PAGE_SIZE = 200;
const RESOURCE_TYPES = ["Patient", "Appointment", "Encounter", "Invoice"] as const;

export class HealthHubFhirClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly cfg: HealthHubConfig) {}

  static from(link: PvsLinkRow): HealthHubFhirClient {
    const c = link.connectionConfig as {
      healthHubBaseUrl?: string;
      healthHubClientId?: string;
      healthHubClientSecret?: string;
      healthHubTokenUrl?: string;
    };
    if (
      !c.healthHubBaseUrl ||
      !c.healthHubClientId ||
      !c.healthHubClientSecret ||
      !c.healthHubTokenUrl
    ) {
      throw new Error("healthhub: incomplete connection_config");
    }
    return new HealthHubFhirClient({
      baseUrl: c.healthHubBaseUrl,
      clientId: c.healthHubClientId,
      clientSecret: c.healthHubClientSecret,
      tokenUrl: c.healthHubTokenUrl,
    });
  }

  async metadata(): Promise<{ fhirVersion?: string }> {
    await this.ensureToken();
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl.replace(/\/$/, "")}/metadata?_format=json`,
      { headers: { authorization: `Bearer ${this.accessToken}` } }
    );
    if (!res.ok) throw new Error(`healthhub metadata ${res.status}`);
    return (await res.json()) as { fhirVersion?: string };
  }

  async *searchAll(sinceIso: string): AsyncIterable<FhirBundle> {
    for (const resType of RESOURCE_TYPES) {
      let url:
        | string
        | null =
        `${this.cfg.baseUrl.replace(/\/$/, "")}/${resType}` +
        `?_lastUpdated=gt${encodeURIComponent(sinceIso)}&_count=${PAGE_SIZE}`;
      while (url) {
        await this.ensureToken();
        const res = await fetchWithTimeout(url, {
          headers: {
            authorization: `Bearer ${this.accessToken}`,
            accept: "application/fhir+json",
          },
        });
        if (!res.ok) {
          throw new Error(
            `healthhub ${resType} ${res.status}: ${await res.text()}`
          );
        }
        const bundle = (await res.json()) as FhirBundle & {
          link?: Array<{ relation: string; url: string }>;
        };
        yield bundle;
        url = bundle.link?.find((l) => l.relation === "next")?.url ?? null;
      }
    }
  }

  private async ensureToken(): Promise<void> {
    if (
      this.accessToken &&
      this.accessTokenExpiresAt > Date.now() + 60_000
    ) {
      return;
    }
    const res = await fetchWithTimeout(this.cfg.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        scope: "patient appointment encounter invoice",
      }),
    });
    if (!res.ok) {
      throw new Error(`healthhub oauth ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
  }
}
