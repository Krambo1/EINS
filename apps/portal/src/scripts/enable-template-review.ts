/**
 * One-shot: enable review-request sending on the `_template` clinic so that
 * `preview-review-email.ts --mint --send <to>` can deliver a real recall
 * with a clickable token.
 *
 * Sets:
 *   reviewRequestEnabled    = true
 *   reviewRequestDelayDays  = 0 (recall is due immediately)
 *   googleReviewUrl         = a public placeholder if currently null
 *
 * Idempotent — re-running leaves existing config alone unless it's null.
 */
import "../worker/shim-server-only";
import "../lib/load-env";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

async function main() {
  const slug = process.argv[2] ?? "_template";

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.slug, slug))
    .limit(1);

  if (!clinic) {
    console.error(`No clinic with slug='${slug}'. Run \`pnpm setup:intake ${slug}\` first.`);
    process.exit(1);
  }

  const patch: {
    reviewRequestEnabled: boolean;
    reviewRequestDelayDays: number;
    googleReviewUrl?: string;
  } = {
    reviewRequestEnabled: true,
    reviewRequestDelayDays: 0,
  };
  if (!clinic.googleReviewUrl && !clinic.jamedaReviewUrl) {
    // Placeholder — any well-formed URL works; the landing only needs ONE
    // public URL to exist so the öffentlich CTA renders something tappable.
    // Swap for a real Google Maps review link when wiring a real Praxis.
    patch.googleReviewUrl = "https://g.page/r/eins-test-placeholder/review";
  }

  await db
    .update(schema.clinics)
    .set(patch)
    .where(eq(schema.clinics.id, clinic.id));

  const [after] = await db
    .select({
      slug: schema.clinics.slug,
      displayName: schema.clinics.displayName,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinic.id))
    .limit(1);

  console.log("Enabled review-request on clinic:");
  console.log(JSON.stringify(after, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
