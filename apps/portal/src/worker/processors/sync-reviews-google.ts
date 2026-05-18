import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasGooglePlaces } from "@/lib/env";

/**
 * Daily Google reviews sync.
 *
 * Calls Places API (New) `places/{placeId}` for the clinic's stored Place ID
 * and writes a fresh row to `reviews` with `platform='google'`. No OAuth —
 * one server-side API key covers every clinic.
 *
 * If the clinic hasn't entered a Place ID yet, or the API key isn't set,
 * this is a no-op (no error, no empty snapshot).
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/place-details
 */

export interface SyncReviewsGoogleJob {
  clinicId: string;
}

const ENDPOINT = "https://places.googleapis.com/v1/places";
const FIELD_MASK = "rating,userRatingCount";

export async function processSyncReviewsGoogle(
  job: SyncReviewsGoogleJob
): Promise<void> {
  const { clinicId } = job;

  if (!hasGooglePlaces()) {
    console.log("[sync-reviews-google] GOOGLE_PLACES_API_KEY missing — skipping");
    return;
  }

  const [clinic] = await db
    .select({ placeId: schema.clinics.googlePlaceId })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);

  if (!clinic?.placeId) {
    console.log(`[sync-reviews-google] clinic=${clinicId} has no place_id — skipping`);
    return;
  }

  const url = `${ENDPOINT}/${encodeURIComponent(clinic.placeId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": FIELD_MASK,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `places api http ${res.status} for clinic=${clinicId} place=${clinic.placeId}: ${body.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    rating?: number;
    userRatingCount?: number;
  };

  const rating = typeof data.rating === "number" ? data.rating : null;
  const totalCount =
    typeof data.userRatingCount === "number" ? data.userRatingCount : 0;

  if (rating === null) {
    console.log(
      `[sync-reviews-google] clinic=${clinicId} place=${clinic.placeId} returned no rating yet — skipping`
    );
    return;
  }

  const clamped = Math.max(0, Math.min(5, rating));

  await db.insert(schema.reviews).values({
    clinicId,
    platform: "google",
    rating: clamped.toFixed(1),
    totalCount,
  });

  console.log(
    `[sync-reviews-google] clinic=${clinicId} rating=${clamped.toFixed(1)} count=${totalCount}`
  );
}
