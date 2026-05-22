import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/audit";

/**
 * Resend bounce / complaint webhook.
 *
 * Adds the recipient to per-clinic `email_suppression` on every clinic
 * that has them as a patient (and on every clinic where they appear as a
 * staff user, for completeness). Without this hook hard bounces accumulate
 * forever, our Resend reputation degrades, and the next outbound send
 * lands in spam for the entire domain.
 *
 * Signature scheme: Resend uses Svix. Header `svix-signature` is one or
 * more `v1,<base64>` entries, computed over `<svix-id>.<svix-timestamp>.<body>`
 * with the webhook secret (the base64 part after `whsec_`). Constant-time
 * compare; any failure → 401 so misconfiguration is loud.
 */

interface ResendBounceEvent {
  type:
    | "email.bounced"
    | "email.complained"
    | "email.delivery_delayed"
    | string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    from?: string;
    subject?: string;
    bounce?: {
      type?: "permanent" | "transient" | string;
      message?: string;
    };
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: { code: "not_configured" } },
      { status: 503 }
    );
  }

  const raw = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: { code: "missing_headers" } },
      { status: 401 }
    );
  }
  if (
    !verifySvixSignature({
      id: svixId,
      timestamp: svixTimestamp,
      body: raw,
      signatureHeader: svixSignature,
      secret: env.RESEND_WEBHOOK_SECRET,
    })
  ) {
    return NextResponse.json(
      { error: { code: "bad_signature" } },
      { status: 401 }
    );
  }

  let event: ResendBounceEvent;
  try {
    event = JSON.parse(raw) as ResendBounceEvent;
  } catch {
    return NextResponse.json(
      { error: { code: "bad_request" } },
      { status: 400 }
    );
  }

  const recipients = (event.data?.to ?? []).map((s) => s.trim().toLowerCase());
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 }, { status: 200 });
  }

  let processed = 0;
  for (const email of recipients) {
    if (event.type === "email.bounced") {
      const isPermanent = event.data?.bounce?.type === "permanent";
      if (!isPermanent) continue; // transient bounces don't suppress
      await suppressEverywhere(email, "bounced", event);
      processed++;
    } else if (event.type === "email.complained") {
      await suppressEverywhere(email, "complained", event);
      processed++;
    }
    // Other event types are acknowledged but no-op.
  }

  return NextResponse.json({ ok: true, processed }, { status: 200 });
}

async function suppressEverywhere(
  email: string,
  reason: "bounced" | "complained",
  event: ResendBounceEvent
): Promise<void> {
  // Find every clinic this address belongs to as a patient. We don't try
  // to derive the clinic from the email_id (Resend doesn't expose tagging
  // back through the webhook reliably). Adding the suppression in *every*
  // clinic that has this recipient is the right default: a hard bounce
  // means the inbox is dead globally, not per-tenant.
  const patientRows = await db
    .select({ clinicId: schema.patients.clinicId })
    .from(schema.patients)
    .where(eq(schema.patients.email, email));

  // Also include clinics where this person is a staff user — magic-link
  // bounces should suppress the staff side too, so we don't keep blasting
  // a dead inbox.
  const userRows = await db
    .select({ clinicId: schema.clinicUsers.clinicId })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.email, email));

  const clinicIds = new Set<string>([
    ...patientRows.map((r) => r.clinicId),
    ...userRows.map((r) => r.clinicId),
  ]);

  for (const clinicId of clinicIds) {
    await db
      .insert(schema.emailSuppression)
      .values({ clinicId, email, reason })
      .onConflictDoNothing({
        target: [
          schema.emailSuppression.clinicId,
          schema.emailSuppression.email,
        ],
      });

    await writeAudit({
      clinicId,
      action: "email_suppress",
      entityKind: "email_suppression",
      diff: {
        email,
        reason,
        provider: "resend",
        eventType: event.type,
        emailId: event.data?.email_id ?? null,
      },
    });
  }
}

/**
 * Svix signature verification. Header looks like:
 *   `svix-signature: v1,<b64sig> v1,<b64sig2>`
 * The signed string is `${svixId}.${svixTimestamp}.${body}`. We accept any
 * v1 entry — Svix sends multiple during key rotation.
 *
 * Constant-time compare; bail false on any parse weirdness so a malformed
 * header can't bypass verification.
 */
function verifySvixSignature(opts: {
  id: string;
  timestamp: string;
  body: string;
  signatureHeader: string;
  secret: string;
}): boolean {
  // Svix secrets are `whsec_<base64>`; strip the prefix and decode.
  const rawSecret = opts.secret.startsWith("whsec_")
    ? opts.secret.slice("whsec_".length)
    : opts.secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(rawSecret, "base64");
  } catch {
    return false;
  }
  const toSign = `${opts.id}.${opts.timestamp}.${opts.body}`;
  const expected = createHmac("sha256", secretBytes).update(toSign).digest();

  for (const entry of opts.signatureHeader.split(" ")) {
    const [version, b64] = entry.split(",");
    if (version !== "v1" || !b64) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      return true;
    }
  }
  return false;
}
