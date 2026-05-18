import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { LatLng } from "./haversine";

/**
 * Nominatim geocoding client with a persistent DB cache and an in-process
 * token bucket. Tuned for the EINS lead scorer:
 *
 *   - One query per lead (the patient's city) + one query per location on
 *     first use (the praxis address). Volume is low.
 *   - Nominatim's ToS asks for ≤ 1 req/sec and a stable identifying
 *     User-Agent. The DB cache is the real volume defense; the in-process
 *     token bucket is belt-and-braces for the case where the cache is empty.
 *   - countrycodes=de,at,ch matches the EINS service area and dramatically
 *     reduces "Berlin, USA" style mis-resolves.
 *
 * Returns null on:
 *   - blank/short queries
 *   - Nominatim "no match"
 *   - HTTP error (we don't want a third-party hiccup to take down scoring;
 *     the worker falls back to "unknown distance" and assigns 0 points).
 */

const POSITIVE_TTL_DAYS = 30;
const NEGATIVE_TTL_DAYS = 7;

const USER_AGENT = "EINS-Visuals/1.0 (team@einsvisuals.com)";

interface NominatimItem {
  lat: string;
  lon: string;
  display_name?: string;
}

// ── In-process rate limiter: 1 req / 1000 ms ──
let nextAllowedAt = 0;
async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextAllowedAt - now);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  nextAllowedAt = Math.max(now, nextAllowedAt) + 1000;
}

export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Resolve a free-text place ("Berlin", "Marienplatz 1, München") to lat/lng.
 * Cache-first against geocode_cache; falls back to Nominatim, persists either
 * positive or negative result.
 */
export async function geocode(query: string): Promise<LatLng | null> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 2) return null;

  // ── 1. Cache lookup ──
  const [hit] = await db
    .select({
      lat: schema.geocodeCache.lat,
      lng: schema.geocodeCache.lng,
      expiresAt: schema.geocodeCache.expiresAt,
    })
    .from(schema.geocodeCache)
    .where(eq(schema.geocodeCache.normalizedQuery, normalized))
    .limit(1);

  if (hit) {
    const fresh = hit.expiresAt.getTime() > Date.now();
    if (fresh) {
      if (hit.lat === null || hit.lng === null) return null;
      return { lat: Number(hit.lat), lng: Number(hit.lng) };
    }
    // Expired — fall through and re-query Nominatim, then upsert.
  }

  // ── 2. Live lookup ──
  await acquireSlot();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de,at,ch");
  url.searchParams.set("q", normalized);

  let result: NominatimItem | null = null;
  let raw: unknown = null;
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.ok) {
      const data = (await res.json()) as NominatimItem[];
      raw = data;
      result = data[0] ?? null;
    } else {
      console.warn(`[nominatim] http ${res.status} for "${normalized}"`);
    }
  } catch (err) {
    console.warn(`[nominatim] fetch failed for "${normalized}":`, err);
  }

  const lat = result ? Number(result.lat) : null;
  const lng = result ? Number(result.lon) : null;
  const positive = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);

  const ttlDays = positive ? POSITIVE_TTL_DAYS : NEGATIVE_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  // ── 3. Upsert into cache ──
  await db
    .insert(schema.geocodeCache)
    .values({
      normalizedQuery: normalized,
      lat: positive ? lat!.toFixed(6) : null,
      lng: positive ? lng!.toFixed(6) : null,
      raw: raw as never,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: schema.geocodeCache.normalizedQuery,
      set: {
        lat: positive ? lat!.toFixed(6) : null,
        lng: positive ? lng!.toFixed(6) : null,
        raw: raw as never,
        fetchedAt: sql`now()`,
        expiresAt,
      },
    });

  return positive ? { lat: lat!, lng: lng! } : null;
}
