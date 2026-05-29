/**
 * EINS Stimme — end-to-end test driver for the review-request pipeline.
 *
 * Modes:
 *   survey  : read-only dump of state needed to send a review email for
 *             a given lead (request) — clinic config, env, HMAC credential.
 *   prep    : write minimal clinic config + intake credential needed to
 *             actually fire (uses --google-url, --landing-origin args).
 *   walk    : transition a lead through statuses until it reaches gewonnen.
 *   fire    : POST /api/patients/events with HMAC, optionally run tick.
 *
 * Always pass --request <uuid> to scope to a specific lead.
 *
 * Usage (PowerShell):
 *   pnpm --filter portal exec tsx src/scripts/test-review-system.ts survey --email karam8issa@gmail.com
 *   pnpm --filter portal exec tsx src/scripts/test-review-system.ts prep --request <uuid> \
 *     --google-url "https://g.page/r/xyz/review"
 *   pnpm --filter portal exec tsx src/scripts/test-review-system.ts walk --request <uuid>
 *   pnpm --filter portal exec tsx src/scripts/test-review-system.ts fire --request <uuid> --tick
 */
import "../worker/shim-server-only";
import "../lib/load-env";
import { randomBytes, createHmac } from "node:crypto";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { encryptString } from "@/lib/crypto";
import { env } from "@/lib/env";
import { processReviewRequestTick } from "@/worker/processors/review-request";

type Args = Record<string, string | true>;
function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const cmd = argv[2] ?? "survey";
  const args: Args = {};
  for (let i = 3; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return { cmd, args };
}

async function findRequest(args: Args) {
  const requestId = typeof args.request === "string" ? args.request : null;
  const email = typeof args.email === "string" ? args.email : null;
  const name = typeof args.name === "string" ? args.name : "Karam";

  if (requestId) {
    const [r] = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);
    return r ?? null;
  }
  // Search by email then by contactName ilike.
  if (email) {
    const [r] = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.contactEmail, email))
      .limit(1);
    if (r) return r;
  }
  const [r] = await db
    .select()
    .from(schema.requests)
    .where(
      or(
        ilike(schema.requests.contactName, `%${name}%`),
        ilike(schema.requests.contactEmail, `%${name}%`)
      )
    )
    .limit(1);
  return r ?? null;
}

async function cmdSurvey(args: Args): Promise<void> {
  const req = await findRequest(args);
  if (!req) {
    console.log("No matching request found.");
    process.exit(2);
  }
  console.log("=== LEAD (requests) ===");
  console.log({
    id: req.id,
    clinicId: req.clinicId,
    status: req.status,
    contactName: req.contactName,
    contactEmail: req.contactEmail,
    patientId: req.patientId,
    createdAt: req.createdAt,
  });

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, req.clinicId))
    .limit(1);
  if (!clinic) {
    console.log("Clinic not found.");
    process.exit(2);
  }
  console.log("\n=== CLINIC (review config) ===");
  console.log({
    id: clinic.id,
    displayName: clinic.displayName,
    reviewRequestEnabled: clinic.reviewRequestEnabled,
    reviewRequestDelayDays: clinic.reviewRequestDelayDays,
    googleReviewUrl: clinic.googleReviewUrl,
    jamedaReviewUrl: clinic.jamedaReviewUrl,
    reviewLandingOrigin: clinic.reviewLandingOrigin,
    reviewEmailFrom: clinic.reviewEmailFrom,
  });

  const [cred] = await db
    .select({ id: schema.platformCredentials.id })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinic.id),
        eq(schema.platformCredentials.platform, "intake")
      )
    )
    .limit(1);
  console.log("\n=== PLATFORM CREDENTIAL (intake / HMAC) ===");
  console.log({ exists: Boolean(cred) });

  console.log("\n=== ENV ===");
  console.log({
    EMAIL_DRIVER: env.EMAIL_DRIVER,
    EMAIL_FROM: env.EMAIL_FROM,
    RESEND_API_KEY_set: Boolean(env.RESEND_API_KEY),
    APP_ORIGIN: env.APP_ORIGIN,
    CLINIC_LANDING_ORIGIN: env.CLINIC_LANDING_ORIGIN,
  });

  console.log("\n=== READY CHECK ===");
  const issues: string[] = [];
  if (!clinic.reviewRequestEnabled) issues.push("clinic.reviewRequestEnabled is false");
  if (!clinic.googleReviewUrl && !clinic.jamedaReviewUrl)
    issues.push("clinic has no googleReviewUrl/jamedaReviewUrl — worker will skip");
  if ((clinic.reviewRequestDelayDays ?? 3) > 0)
    issues.push(`clinic.reviewRequestDelayDays=${clinic.reviewRequestDelayDays} — recall will be scheduled in the future`);
  if (!cred) issues.push("missing platform_credentials row for platform='intake' — HMAC auth will fail");
  if (env.EMAIL_DRIVER !== "resend") issues.push(`EMAIL_DRIVER='${env.EMAIL_DRIVER}' — set to 'resend' for real email`);
  if (!env.RESEND_API_KEY) issues.push("RESEND_API_KEY not set — Resend driver cannot send");
  if (!req.contactEmail) issues.push("request has no contactEmail — patient-events needs an email");
  if (issues.length === 0) console.log("All checks passed ✓");
  else for (const i of issues) console.log("- " + i);
}

async function cmdPrep(args: Args): Promise<void> {
  const req = await findRequest(args);
  if (!req) throw new Error("request not found");
  const googleUrl =
    typeof args["google-url"] === "string" ? args["google-url"] : null;
  const landingOrigin =
    typeof args["landing-origin"] === "string" ? args["landing-origin"] : null;
  const reviewEmailFrom =
    typeof args["from"] === "string" ? args["from"] : null;

  // 1) clinic config
  await db
    .update(schema.clinics)
    .set({
      reviewRequestEnabled: true,
      reviewRequestDelayDays: 0,
      ...(googleUrl ? { googleReviewUrl: googleUrl } : {}),
      ...(landingOrigin ? { reviewLandingOrigin: landingOrigin } : {}),
      ...(reviewEmailFrom ? { reviewEmailFrom } : {}),
    })
    .where(eq(schema.clinics.id, req.clinicId));
  console.log(
    `clinic ${req.clinicId} → reviewRequestEnabled=true, reviewRequestDelayDays=0` +
      (googleUrl ? `, googleReviewUrl=${googleUrl}` : "") +
      (landingOrigin ? `, reviewLandingOrigin=${landingOrigin}` : "") +
      (reviewEmailFrom ? `, reviewEmailFrom=${reviewEmailFrom}` : "")
  );

  // 2) intake credential (HMAC secret) — create only if missing
  const [existing] = await db
    .select({ id: schema.platformCredentials.id })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, req.clinicId),
        eq(schema.platformCredentials.platform, "intake")
      )
    )
    .limit(1);
  if (!existing) {
    const secret = randomBytes(32).toString("hex");
    await db.insert(schema.platformCredentials).values({
      clinicId: req.clinicId,
      platform: "intake",
      accessTokenEnc: encryptString(secret),
    });
    console.log(`intake credential created for clinic ${req.clinicId}`);
    console.log(`  (HMAC secret written encrypted — fire step reads it back)`);
  } else {
    console.log(`intake credential already exists for clinic ${req.clinicId}`);
  }
}

async function cmdWalk(args: Args): Promise<void> {
  const req = await findRequest(args);
  if (!req) throw new Error("request not found");
  const path = [
    "neu",
    "termin_vereinbart",
    "beratung_erschienen",
    "gewonnen",
  ] as const;
  // If the lead is on a terminal off-path status (verloren/spam) the state
  // machine has no valid transition forward — force-set to 'gewonnen' for the
  // test rather than walking. This bypasses STATUS_TRANSITIONS by design;
  // we're scripting a test, not driving the prod UI.
  const offPath = req.status === "verloren" || req.status === "spam";
  const startIdx = offPath
    ? path.length - 2
    : path.indexOf(req.status as (typeof path)[number]);
  if (startIdx < 0) {
    console.log(`current status='${req.status}' unknown; aborting walk`);
    return;
  }
  if (offPath) {
    console.log(`current status='${req.status}' is terminal; force-setting to 'gewonnen'`);
  }
  for (let i = startIdx + 1; i < path.length; i++) {
    const newStatus = path[i]!;
    await db
      .update(schema.requests)
      .set({
        status: newStatus,
        wonAt: newStatus === "gewonnen" ? new Date() : undefined,
      })
      .where(eq(schema.requests.id, req.id));
    await db.insert(schema.requestActivities).values({
      requestId: req.id,
      kind: "status_change",
      body: `${path[i - 1]} → ${newStatus} (test driver)`,
      meta: { from: path[i - 1], to: newStatus, source: "test-review-system" },
    });
    console.log(`  → ${newStatus}`);
  }
  console.log("walk complete");
}

async function cmdFire(args: Args): Promise<void> {
  const req = await findRequest(args);
  if (!req) throw new Error("request not found");
  if (!req.contactEmail) throw new Error("request has no contactEmail");

  // Pull HMAC secret
  const [cred] = await db
    .select({ accessTokenEnc: schema.platformCredentials.accessTokenEnc })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, req.clinicId),
        eq(schema.platformCredentials.platform, "intake")
      )
    )
    .limit(1);
  if (!cred) throw new Error("no intake credential for clinic — run `prep` first");
  const { decryptString } = await import("@/lib/crypto");
  const secret = decryptString(cred.accessTokenEnc);

  const body = JSON.stringify({
    clinicId: req.clinicId,
    eventKind: "appointment_completed",
    patient: {
      email: req.contactEmail,
      fullName: req.contactName ?? "Karam",
    },
    appointmentCompletedAt: new Date().toISOString(),
    treatmentLabel: req.treatmentWish ?? null,
    reviewConsent: true,
  });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  // APP_ORIGIN points at the admin subdomain in dev (admin.localhost:3001),
  // which middleware rewrites all paths to /admin/* — would 404 the API route.
  // Use plain localhost:3001 (or a clinic subdomain) for the webhook origin,
  // overridable via --origin.
  const originOverride =
    typeof args.origin === "string" ? args.origin : "http://localhost:3001";
  const url = `${originOverride.replace(/\/$/, "")}/api/patients/events`;
  console.log(`POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sig,
    },
    body,
  });
  const text = await res.text();
  console.log(`  status=${res.status}  body=${text}`);
  if (!res.ok) throw new Error("patient-events POST failed");

  if (args.tick === true) {
    console.log("\nrunning processReviewRequestTick()...");
    await processReviewRequestTick();
    console.log("tick done — check the email-send queue / inbox");
  } else {
    console.log("\n(skip --tick to wait for the cron every-15-min schedule)");
  }
}

async function main() {
  const { cmd, args } = parseArgs(process.argv);
  switch (cmd) {
    case "survey":
      await cmdSurvey(args);
      break;
    case "prep":
      await cmdPrep(args);
      break;
    case "walk":
      await cmdWalk(args);
      break;
    case "fire":
      await cmdFire(args);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
