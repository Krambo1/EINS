import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * Daily Jameda reviews sync.
 *
 * Jameda has no public API. We fetch the public profile page and parse the
 * schema.org JSON-LD block embedded by Jameda for SEO. Their AggregateRating
 * uses German school grades (1.0 = best, 6.0 = worst) — we detect the scale
 * from `bestRating`/`worstRating` and normalize to a 5-star value so the
 * tile is comparable to Google.
 *
 * If the clinic hasn't entered a profile URL yet, this is a no-op. If Jameda
 * changes their markup and we can't find the JSON-LD, the job throws and
 * BullMQ retries — surfacing the breakage instead of writing bad data.
 */

export interface SyncReviewsJamedaJob {
  clinicId: string;
}

const USER_AGENT =
  "EINS-Portal/1.0 (+https://eins.ag; review sync; contact: team@eins.ag)";

interface AggregateRating {
  ratingValue?: string | number;
  bestRating?: string | number;
  worstRating?: string | number;
  ratingCount?: string | number;
  reviewCount?: string | number;
}

export async function processSyncReviewsJameda(
  job: SyncReviewsJamedaJob
): Promise<void> {
  const { clinicId } = job;

  const [clinic] = await db
    .select({ profileUrl: schema.clinics.jamedaProfileUrl })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);

  if (!clinic?.profileUrl) {
    console.log(
      `[sync-reviews-jameda] clinic=${clinicId} has no profile URL — skipping`
    );
    return;
  }

  const html = await fetchProfileHtml(clinic.profileUrl);
  const rating = extractAggregateRating(html);

  if (!rating) {
    throw new Error(
      `jameda: no AggregateRating JSON-LD found at ${clinic.profileUrl}`
    );
  }

  const normalized = normalizeToFiveStar(rating);
  if (normalized === null) {
    throw new Error(
      `jameda: could not parse ratingValue at ${clinic.profileUrl}`
    );
  }

  const totalCount = parseCount(rating.reviewCount ?? rating.ratingCount) ?? 0;

  await db.insert(schema.reviews).values({
    clinicId,
    platform: "jameda",
    rating: normalized.toFixed(1),
    totalCount,
  });

  console.log(
    `[sync-reviews-jameda] clinic=${clinicId} rating=${normalized.toFixed(1)} count=${totalCount}`
  );
}

async function fetchProfileHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de-DE,de;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`jameda fetch http ${res.status} for ${url}`);
  return res.text();
}

/**
 * Find the first JSON-LD block that contains an AggregateRating, anywhere
 * in the document tree (top-level or nested under MedicalBusiness/Physician).
 */
function extractAggregateRating(html: string): AggregateRating | null {
  const blocks = matchAllScripts(html);
  for (const raw of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const rating = findAggregateRating(parsed);
    if (rating) return rating;
  }
  return null;
}

function matchAllScripts(html: string): string[] {
  const out: string[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

function findAggregateRating(node: unknown): AggregateRating | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findAggregateRating(item);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (
    (type === "AggregateRating" ||
      (Array.isArray(type) && type.includes("AggregateRating"))) &&
    (obj.ratingValue !== undefined)
  ) {
    return obj as AggregateRating;
  }
  // Recurse into common containers.
  for (const value of Object.values(obj)) {
    const hit = findAggregateRating(value);
    if (hit) return hit;
  }
  return null;
}

/**
 * Convert Jameda's school-grade rating (best=1, worst=6) to a 5-star value.
 * Falls back to identity if the scale already looks like 5-star.
 */
function normalizeToFiveStar(r: AggregateRating): number | null {
  const value = toNumber(r.ratingValue);
  if (value === null) return null;
  const best = toNumber(r.bestRating);
  const worst = toNumber(r.worstRating);

  // German school grade scale: best < worst (e.g. 1..6). Map 1→5, 6→0.
  if (best !== null && worst !== null && best < worst) {
    const span = worst - best;
    if (span <= 0) return null;
    // Lower input = better; flip so higher output = better.
    const flipped = worst - value;
    const fiveStar = (flipped / span) * 5;
    return clamp(fiveStar, 0, 5);
  }

  // Standard 5-star scale (best > worst, or both unspecified).
  return clamp(value, 0, 5);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Jameda usually uses dot-decimals in JSON-LD even though the UI is German.
    const parsed = Number(v.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCount(v: unknown): number | null {
  const n = toNumber(v);
  if (n === null) return null;
  return Math.max(0, Math.round(n));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
