import { hubspotAdapter } from "./hubspot";
import { ghlAdapter } from "./ghl";
import { rawAdapter } from "./raw";
import type { CRMAdapter } from "./adapter";

const ADAPTERS: Record<string, CRMAdapter> = {
  hubspot: hubspotAdapter,
  ghl: ghlAdapter,
  raw: rawAdapter,
};

/** Pick the configured adapter from env. Defaults to `raw` (n8n-friendly). */
export function pickAdapter(): CRMAdapter {
  const id = (process.env.LEAD_CRM_ADAPTER ?? "raw").toLowerCase();
  return ADAPTERS[id] ?? rawAdapter;
}

/**
 * Look up the per-clinic webhook URL.
 *
 * Resolution order:
 *   1. `LEAD_WEBHOOK_URL_<UPPER_SLUG>` env var
 *   2. `clinic.connectors.webhookUrl` (set in `clinic.ts`)
 *
 * Env always wins so production secrets don't leak into git.
 */
export function webhookUrlForClinic(clinicSlug: string, fallback?: string): string | undefined {
  const key = `LEAD_WEBHOOK_URL_${clinicSlug.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key] ?? fallback;
}

export type { CRMAdapter, MarketingConfirmedEvent } from "./adapter";
export { postMarketingConfirmed } from "./adapter";
