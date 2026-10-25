import "server-only";

/**
 * Google Ads REST API version (E-17). Google sunsets each version roughly a
 * year after release; v18 was already gone. Override with
 * GOOGLE_ADS_API_VERSION (e.g. "v24") without a code change when Google
 * announces the next sunset. A 404 from the API is reported as "version
 * sunset?".
 */
export const GOOGLE_ADS_API_VERSION =
  process.env.GOOGLE_ADS_API_VERSION?.trim() || "v23";
