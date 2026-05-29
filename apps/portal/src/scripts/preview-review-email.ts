/**
 * Renders the patient review-request email to ./review-preview.html so the
 * design can be eyeballed in a browser without spinning up the full
 * worker / DB / Mailhog stack.
 *
 * Run:
 *   pnpm --filter portal exec tsx src/scripts/preview-review-email.ts
 *
 * IMPORTANT — rating links and the clinic-landing app:
 *
 * By default this script uses a DUMMY token and points the rating links at
 * http://localhost:3002 (the standard clinic-landing dev origin). Clicking
 * a star will hit the landing's `/r/[token]/page.tsx`, which calls
 * `resolveToken(token)` against the database and renders a 404 ("Seite
 * nicht gefunden") when the token isn't a real `review_email_schedule` row.
 *
 * THIS IS EXPECTED. The preview's job is visual QA, not flow testing. To
 * click a star and have the landing actually resolve, either:
 *
 *   (a) pass `--token <hex>` with a real token from a recent review-request
 *       row, or
 *
 *   (b) mint a real review-request row first by running:
 *         pnpm --filter portal exec tsx src/scripts/test-review-system.ts \
 *           fire --request <uuid> --tick
 *       …which generates a real `review_email_schedule` row + fires the
 *       worker. The worker logs the rendered email (with its real rating
 *       URLs) to the console — copy a URL from there, or copy its token
 *       and paste it here via `--token`.
 *
 *   (c) pass `--mint` to insert a fresh review-request row directly.
 *       Requires DATABASE_URL set + a clinic that already has
 *       reviewRequestEnabled and at least one of googleReviewUrl /
 *       jamedaReviewUrl (run `pnpm --filter portal setup:intake _template`
 *       first if you need a fresh template clinic).
 *
 * Optional flags:
 *   --no-treatment      Drop the treatment label (hides Behandlung cell
 *                       + simplifies the rating-prompt phrasing).
 *   --no-name           Generic salutation (no patient first name).
 *   --no-date           Drop the appointment date (hides date cell + the
 *                       date phrase in body intro + footer reminder).
 *   --no-doctor         Drop the practitioner (hides Behandelt-von cell).
 *   --no-extras         Drop specialty, location, date, doctor at once —
 *                       stress-tests the minimal-data degradation path.
 *   --token <hex>       Use a real token instead of the dummy.
 *   --landing <url>     Override the landing origin (default
 *                       http://localhost:3002).
 *   --mint              Insert a fresh review_email_schedule row and use
 *                       its token. Requires DB connectivity.
 *   --clinic-slug <s>   Used with --mint to pick which clinic the row
 *                       attaches to (default `_template`).
 *   --send <to-email>   ACTUALLY DELIVER the rendered email via the
 *                       configured EMAIL_DRIVER (resend / mailhog /
 *                       console). Pair with --mint to get a real clickable
 *                       token in the delivered mail.
 *   --out <path>        Output path (default ./review-preview.html).
 */
import "../worker/shim-server-only";
import "../lib/load-env";
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { renderReviewRequestEmail } from "@/server/email/templates/review-request";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const optional = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")
    ? (args[i + 1] as string)
    : null;
};

const noExtras = flag("--no-extras");
const withTreatment = !flag("--no-treatment") && !noExtras;
const withName = !flag("--no-name");
const withDate = !flag("--no-date") && !noExtras;
const withDoctor = !flag("--no-doctor") && !noExtras;
const withSpecialty = !noExtras;
const withLocation = !noExtras;

const explicitToken = optional("--token");
const landingOrigin =
  optional("--landing") ?? "http://localhost:3002";
const outPath = optional("--out")
  ? path.resolve(optional("--out") as string)
  : path.resolve(process.cwd(), "review-preview.html");

const DUMMY_TOKEN = "fSlDJOI_5ioW4ElRercgsQNPHS9EwKAqs-OXjqDjDCA";

async function resolveToken(): Promise<{
  token: string;
  source: "dummy" | "explicit" | "minted";
  mintedClinic?: string;
  mintedScheduleId?: string;
}> {
  if (explicitToken) {
    return { token: explicitToken, source: "explicit" };
  }
  if (!flag("--mint")) {
    return { token: DUMMY_TOKEN, source: "dummy" };
  }

  // --mint: insert a real recall against an existing clinic. We import the
  // DB layer lazily so the script's default (dummy) path stays DB-free —
  // dotenv may have loaded DATABASE_URL, but if it didn't, dummy-mode still
  // works while --mint surfaces a clean error.
  const { db, schema } = await import("@/db/client");
  const { eq } = await import("drizzle-orm");

  const clinicSlug = optional("--clinic-slug") ?? "_template";

  const [clinic] = await db
    .select({
      id: schema.clinics.id,
      displayName: schema.clinics.displayName,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.slug, clinicSlug))
    .limit(1);

  if (!clinic) {
    throw new Error(
      `--mint: no clinic with slug='${clinicSlug}'. Run ` +
        `\`pnpm --filter portal setup:intake ${clinicSlug}\` first, or pass ` +
        `--clinic-slug <existing-slug>.`
    );
  }
  if (!clinic.reviewRequestEnabled) {
    throw new Error(
      `--mint: clinic '${clinicSlug}' has reviewRequestEnabled=false. Enable ` +
        `it in the portal (Einstellungen → Bewertungen) or via SQL before minting.`
    );
  }
  if (!clinic.googleReviewUrl && !clinic.jamedaReviewUrl) {
    throw new Error(
      `--mint: clinic '${clinicSlug}' has neither googleReviewUrl nor ` +
        `jamedaReviewUrl set — the landing would render an empty CTA. Set one ` +
        `via SQL or the portal UI before minting.`
    );
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  const [scheduleRow] = await db
    .insert(schema.reviewEmailSchedule)
    .values({
      clinicId: clinic.id,
      kind: "review_request",
      status: "sent", // already "sent" so the worker doesn't double-fire on this preview row
      scheduledFor: new Date().toISOString().slice(0, 10),
      reviewToken: token,
      reviewTokenExpiresAt: expiresAt,
      reviewEmail: "preview@eins.test",
      reviewPatientName: withName ? "Schmidt" : null,
      reviewTreatmentLabel: withTreatment ? "Hyaluron-Behandlung" : null,
      note: "minted by preview-review-email.ts",
      sentAt: new Date(),
    })
    .returning({ id: schema.reviewEmailSchedule.id });

  return {
    token,
    source: "minted",
    mintedClinic: clinic.displayName,
    mintedScheduleId: scheduleRow!.id,
  };
}

async function main(): Promise<void> {
  const resolved = await resolveToken();

  const rendered = renderReviewRequestEmail({
    clinicName: "Praxis Dr. Berger",
    patientName: withName ? "Schmidt" : null,
    treatmentLabel: withTreatment ? "Hyaluron-Behandlung" : null,
    appointmentDate: withDate ? new Date("2026-05-16T18:30:00Z") : null,
    practiceSpecialty: withSpecialty ? "Ästhetische Medizin" : null,
    practiceLocation: withLocation ? "Düsseldorf" : null,
    practitionerName: withDoctor ? "Berger" : null,
    landingOrigin,
    token: resolved.token,
  });

  writeFileSync(outPath, rendered.html, "utf8");

  // Sanity grep.
  const undefinedHits = rendered.html.match(/undefined/g)?.length ?? 0;
  const emDashHits = rendered.html.match(/—/g)?.length ?? 0;
  const starAnchors = rendered.html.match(/aria-label="\d von 5 Sternen"/g)?.length ?? 0;
  const ratingLinks = (rendered.html.match(/\?rating=\d/g) ?? []).length;
  const hasUnsub = rendered.html.includes("/r/unsubscribe?token=");
  const hasSentMeta = rendered.html.includes("Versendet über EINS");
  const hasBrandRow = rendered.html.includes("Versendet im Auftrag Ihrer Praxis");

  console.log(`subject:         ${rendered.subject}`);
  console.log(`html bytes:      ${rendered.html.length}`);
  console.log(`text bytes:      ${rendered.text.length}`);
  console.log(`undefined hits:  ${undefinedHits}${undefinedHits === 0 ? " ✓" : " ✗"}`);
  console.log(`em-dash hits:    ${emDashHits}${emDashHits === 0 ? " ✓" : " ✗"}`);
  console.log(`star anchors:    ${starAnchors}${starAnchors === 5 ? " ✓" : " ✗"}`);
  console.log(`rating links:    ${ratingLinks}${ratingLinks === 5 ? " ✓" : " ✗"}`);
  console.log(`unsub link:      ${hasUnsub ? "present ✓" : "MISSING ✗"}`);
  console.log(`brand row:       ${hasBrandRow ? "present ✓" : "MISSING ✗"}`);
  console.log(`sent-meta:       ${hasSentMeta ? "present ✓" : "MISSING ✗"}`);
  console.log(`landing origin:  ${landingOrigin}`);
  console.log(`token source:    ${resolved.source}${
    resolved.source === "minted"
      ? ` (clinic="${resolved.mintedClinic}", schedule=${resolved.mintedScheduleId})`
      : resolved.source === "dummy"
        ? " — clicks WILL 404 on the landing"
        : ""
  }`);
  console.log(`output:          ${outPath}`);

  if (resolved.source === "dummy") {
    console.log(``);
    console.log(`▸ Want clickable stars that resolve to the landing?`);
    console.log(`    --token <hex>  use a real token you already have`);
    console.log(`    --mint         insert a fresh recall row (needs DB + a clinic)`);
  }

  // --- Optional: actually deliver the email --------------------------------
  // Goes through the same getEmailSender() factory the worker uses, so the
  // driver matches whatever EMAIL_DRIVER + RESEND_API_KEY / mailhog are
  // configured for. unsubscribeUrl is passed so List-Unsubscribe headers
  // (RFC 8058 + §7 UWG one-click) are attached even on test sends.

  const sendTo = optional("--send");
  if (sendTo) {
    const { getEmailSender } = await import("@/server/email");
    const sender = getEmailSender();
    const unsubscribeUrl = `${landingOrigin}/r/unsubscribe?token=${encodeURIComponent(resolved.token)}`;
    console.log(``);
    console.log(`▸ Delivering to ${sendTo} via configured EMAIL_DRIVER…`);
    try {
      await sender.send({
        to: sendTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        unsubscribeUrl,
      });
      console.log(`  delivered ✓`);
      if (resolved.source === "dummy") {
        console.log(
          `  (token is dummy — clicking stars in the delivered mail will 404 ` +
            `on the landing; re-run with --mint to get a clickable token)`
        );
      }
    } catch (err) {
      console.error(`  send failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
