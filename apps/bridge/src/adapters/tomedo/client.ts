import type { PvsLinkRow } from "../../db/client.js";

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
    const res = await fetch(url, {
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
    const res = await fetch(tokenUrl, {
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
    for (;;) {
      await this.ensureToken();
      const url =
        `${this.cfg.endpoint.replace(/\/$/, "")}${path}` +
        `?modifiedSince=${encodeURIComponent(modifiedSince)}` +
        `&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${this.accessToken}` },
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 5);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`tomedo GET ${path} ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as { items: RawRecord[]; total?: number };
      for (const item of data.items ?? []) yield item;
      if ((data.items ?? []).length < PAGE_SIZE) return;
      offset += PAGE_SIZE;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
