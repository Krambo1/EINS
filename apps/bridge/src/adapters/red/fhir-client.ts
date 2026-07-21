import type { PvsLinkRow } from "../../db/client.js";
import type { FhirBundle } from "../_fhir/normalize-shared.js";
import { fetchWithTimeout } from "../../http.js";

/**
 * Thin FHIR client for RED interchange.
 *
 * Auth: Basic auth (client_id:client_secret) over HTTPS. RED's admin
 * panel emits these credentials directly to the inhaber — no akkreditierung
 * dance. Otherwise the same FHIR R4 surface as HealthHub.
 */
interface RedConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

const PAGE_SIZE = 200;
const RESOURCE_TYPES = ["Patient", "Appointment", "Encounter", "Invoice"] as const;

export class RedFhirClient {
  constructor(private readonly cfg: RedConfig) {}

  static from(link: PvsLinkRow): RedFhirClient {
    const c = link.connectionConfig as {
      redBaseUrl?: string;
      redClientId?: string;
      redClientSecret?: string;
    };
    if (!c.redBaseUrl || !c.redClientId || !c.redClientSecret) {
      throw new Error("red: incomplete connection_config");
    }
    return new RedFhirClient({
      baseUrl: c.redBaseUrl,
      clientId: c.redClientId,
      clientSecret: c.redClientSecret,
    });
  }

  private authHeader(): string {
    const tok = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`
    ).toString("base64");
    return `Basic ${tok}`;
  }

  async metadata(): Promise<{ fhirVersion?: string }> {
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl.replace(/\/$/, "")}/metadata?_format=json`,
      { headers: { authorization: this.authHeader() } }
    );
    if (!res.ok) throw new Error(`red metadata ${res.status}`);
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
        const res = await fetchWithTimeout(url, {
          headers: {
            authorization: this.authHeader(),
            accept: "application/fhir+json",
          },
        });
        if (!res.ok) {
          throw new Error(`red ${resType} ${res.status}: ${await res.text()}`);
        }
        const bundle = (await res.json()) as FhirBundle & {
          link?: Array<{ relation: string; url: string }>;
        };
        yield bundle;
        url = bundle.link?.find((l) => l.relation === "next")?.url ?? null;
      }
    }
  }

  async createSubscription(
    channelEndpoint: string,
    outboundSecret: string
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const resType of RESOURCE_TYPES) {
      const body = {
        resourceType: "Subscription",
        status: "requested",
        reason: "EINS: ROAS sync",
        criteria: `${resType}?_lastUpdated=gt${new Date(0).toISOString()}`,
        channel: {
          type: "rest-hook",
          endpoint: channelEndpoint,
          payload: "application/fhir+json",
          header: [`x-red-secret: ${outboundSecret}`],
        },
      };
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl.replace(/\/$/, "")}/Subscription`,
        {
          method: "POST",
          headers: {
            authorization: this.authHeader(),
            "content-type": "application/fhir+json",
          },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        throw new Error(
          `red subscription ${resType} ${res.status}: ${await res.text()}`
        );
      }
      const data = (await res.json()) as { id: string };
      ids.push(data.id);
    }
    return ids;
  }
}
