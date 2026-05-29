/**
 * Render the patient review-request email and actually send it via the
 * configured EMAIL_DRIVER (Resend in dev). Mints a real review_email_schedule
 * row first so the rating links in the inbox actually resolve on the
 * clinic-landing app (instead of 404ing).
 *
 * Run:
 *   pnpm --filter portal exec tsx src/scripts/send-review-email.ts [recipient]
 *   pnpm --filter portal exec tsx src/scripts/send-review-email.ts karam8issa@gmail.com --clinic-slug _template
 *
 * Defaults:
 *   recipient    = karam8issa@gmail.com
 *   clinic-slug  = _template  (must exist, have reviewRequestEnabled=true,
 *                              and at least one of googleReviewUrl /
 *                              jamedaReviewUrl set)
 */
import "../worker/shim-server-only";
import "../lib/load-env";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { renderReviewRequestEmail } from "@/server/email/templates/review-request";
import { getEmailSender } from "@/server/email";
import { env } from "@/lib/env";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const optional = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")
    ? (args[i + 1] as string)
    : null;
};

const to = positional[0] ?? "karam8issa@gmail.com";
const clinicSlug = optional("--clinic-slug") ?? "_template";

async function mintToken(): Promise<{
  token: string;
  clinicId: string;
  clinicName: string;
  landingOrigin: string;
}> {
  const [clinic] = await db
    .select({
      id: schema.clinics.id,
      displayName: schema.clinics.displayName,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
      reviewLandingOrigin: schema.clinics.reviewLandingOrigin,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.slug, clinicSlug))
    .limit(1);

  if (!clinic) {
    throw new Error(
      `No clinic with slug='${clinicSlug}'. Run ` +
        `\`pnpm --filter portal setup:intake ${clinicSlug}\` first, or pass ` +
        `--clinic-slug <existing-slug>.`
    );
  }
  if (!clinic.reviewRequestEnabled) {
    throw new Error(
      `Clinic '${clinicSlug}' has reviewRequestEnabled=false. Enable it ` +
        `via the portal (Einstellungen → Bewertungen) or SQL before sending.`
    );
  }
  if (!clinic.googleReviewUrl && !clinic.jamedaReviewUrl) {
    throw new Error(
      `Clinic '${clinicSlug}' has neither googleReviewUrl nor jamedaReviewUrl ` +
        `set — the landing would render an empty CTA. Configure one first.`
    );
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  await db.insert(schema.reviewEmailSchedule).values({
    clinicId: clinic.id,
    kind: "review_request",
    // 'sent' so the cron worker won't pick this row up and double-fire.
    status: "sent",
    scheduledFor: new Date().toISOString().slice(0, 10),
    reviewToken: token,
    reviewTokenExpiresAt: expiresAt,
    reviewEmail: to,
    reviewPatientName: "Schmidt",
    reviewTreatmentLabel: "Hyaluron-Behandlung",
    note: "minted by send-review-email.ts",
    sentAt: new Date(),
  });

  return {
    token,
    clinicId: clinic.id,
    clinicName: clinic.displayName,
    landingOrigin: clinic.reviewLandingOrigin ?? env.CLINIC_LANDING_ORIGIN,
  };
}

async function main() {
  const { token, clinicName, landingOrigin } = await mintToken();

  const rendered = renderReviewRequestEmail({
    clinicName,
    patientName: "Schmidt",
    treatmentLabel: "Hyaluron-Behandlung",
    appointmentDate: new Date("2026-05-16T18:30:00Z"),
    practiceSpecialty: "Ästhetische Medizin",
    practiceLocation: "Düsseldorf",
    practitionerName: "Berger",
    landingOrigin: landingOrigin.replace(/\/$/, ""),
    token,
  });

  const unsubscribeUrl = `${landingOrigin.replace(/\/$/, "")}/r/unsubscribe?token=${token}`;

  const sender = getEmailSender();
  await sender.send({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    unsubscribeUrl,
  });

  console.log(`Sent via ${env.EMAIL_DRIVER} driver`);
  console.log(`To:       ${to}`);
  console.log(`From:     ${env.EMAIL_FROM}`);
  console.log(`Subject:  ${rendered.subject}`);
  console.log(`Clinic:   ${clinicName} (slug=${clinicSlug})`);
  console.log(`Token:    ${token}`);
  console.log(`Landing:  ${landingOrigin.replace(/\/$/, "")}/r/${token}?rating=5`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Send failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
