import { NextResponse, after, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, hasMeta } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import { persistLead } from "@/server/leads";
import { findCredentialByMetaPageId } from "@/server/meta-pages";

/**
 * Meta Lead-Ads — leadgen webhook ingestion.
 *
 * Meta delivers each form submission as a tiny envelope identifying the
 * page, the leadgen_id, and (optionally) ad/adset/campaign/form ids. The
 * actual form_data is NOT in the webhook — we have to call back into the
 * Graph API with the per-page access token to read field_data.
 *
 * Why a separate route (vs. extending /api/leads/intake):
 *   • Meta signs with X-Hub-Signature-256 using the App secret, not a
 *     per-clinic intake secret. Different verification logic.
 *   • The lead body comes in via a second Graph API call, not the inbound
 *     request body, so the route shape is fundamentally different.
 *
 * Idempotency: persistLead does ON CONFLICT DO NOTHING on
 * (clinic_id, meta_lead_id). Meta retries until 2xx, so this matters a lot.
 *
 * Security:
 *   • GET verify endpoint requires META_LEADGEN_VERIFY_TOKEN (configured
 *     in the App dashboard at subscription time).
 *   • POST requires a valid X-Hub-Signature-256 over the raw body. The
 *     constant-time compare avoids timing leaks on bad sigs.
 */

interface LeadgenChange {
  field: string;
  value: {
    leadgen_id: string;
    page_id: string;
    ad_id?: string;
    adgroup_id?: string;
    form_id?: string;
    created_time?: number;
  };
}

interface LeadgenEntry {
  id: string; // page_id
  time: number;
  changes: LeadgenChange[];
}

interface LeadgenPayload {
  object?: string;
  entry?: LeadgenEntry[];
}

interface FieldData {
  name: string;
  values: string[];
}

interface GraphLead {
  id: string;
  created_time?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
  field_data?: FieldData[];
}

// ---------------------------------------------------------------
// GET — webhook verification (Meta hits this on subscribe).
// ---------------------------------------------------------------

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!env.META_LEADGEN_VERIFY_TOKEN) {
    return new NextResponse("not configured", { status: 503 });
  }

  if (mode === "subscribe" && token === env.META_LEADGEN_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// ---------------------------------------------------------------
// POST — leadgen events.
// ---------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!hasMeta() || !env.META_APP_SECRET) {
    return NextResponse.json({ error: { code: "not_configured" } }, { status: 503 });
  }

  const raw = await request.text();
  const sig = request.headers.get("x-hub-signature-256");
  if (!sig || !verifyMetaSignature(raw, sig, env.META_APP_SECRET)) {
    // Per Meta's docs we should still respond 200 to acknowledge — anything
    // else makes Meta back off the subscription. But for a *bad sig* we
    // return 401 so we can spot misconfiguration in logs without the noise
    // of legitimate retries. Meta will retry; if the secret is wrong we
    // want that loud.
    return NextResponse.json({ error: { code: "bad_signature" } }, { status: 401 });
  }

  let payload: LeadgenPayload;
  try {
    payload = JSON.parse(raw) as LeadgenPayload;
  } catch {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }

  if (payload.object && payload.object !== "page") {
    // We subscribed to the `page` object → anything else is misrouted.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Process each entry. We respond 200 as long as we touched the payload —
  // per-entry failures are logged and Meta will not retry the whole batch.
  // (Returning non-2xx triggers retries of the entire batch, which would
  // duplicate the successful ones.)
  const results: Array<{ leadgenId: string; status: string }> = [];
  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId) continue;
      try {
        const status = await ingestOne(pageId, change.value);
        results.push({ leadgenId, status });
      } catch (err) {
        console.error(
          `[meta-leadgen] ingest failed page=${pageId} leadgen=${leadgenId}:`,
          err
        );
        results.push({ leadgenId, status: "error" });
      }
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results }, {
    status: 200,
  });
}

// ---------------------------------------------------------------
// One-lead ingestion path.
// ---------------------------------------------------------------

async function ingestOne(
  pageId: string,
  value: LeadgenChange["value"]
): Promise<"inserted" | "deduped" | "unbound_page" | "missing_lead"> {
  const cred = await findCredentialByMetaPageId(pageId);
  if (!cred) {
    // Webhook from a Page no clinic owns — happens when a Praxis disconnects
    // but Meta still has an active subscription. Log so we can clean up the
    // subscription on Meta's side, but acknowledge.
    console.warn(`[meta-leadgen] no clinic bound to page=${pageId}`);
    return "unbound_page";
  }

  const lead = await fetchLeadFromGraph(value.leadgen_id, cred.pageAccessToken);
  if (!lead) return "missing_lead";

  const fields = mapFieldData(lead.field_data ?? []);
  const result = await persistLead(cred.clinicId, {
    source: "meta",
    sourceCampaignId: lead.campaign_id ?? value.adgroup_id ?? null,
    sourceAdId: lead.ad_id ?? value.ad_id ?? null,
    utm: null,
    contactName: fields.fullName,
    contactEmail: fields.email,
    contactPhone: fields.phone,
    treatmentWish: fields.treatmentWish,
    budgetIndication: null,
    message: fields.message,
    dsgvoConsent: true, // Meta forms require explicit DSGVO acknowledgement.
    dsgvoConsentIp: null,
    rawPayload: {
      meta: {
        leadgenId: lead.id,
        pageId,
        adId: lead.ad_id ?? value.ad_id ?? null,
        adsetId: lead.adset_id ?? null,
        campaignId: lead.campaign_id ?? null,
        formId: lead.form_id ?? value.form_id ?? null,
        createdTime: lead.created_time ?? null,
        fieldData: lead.field_data ?? [],
      },
    },
    metaLeadId: lead.id,
  });

  // Audit each ingestion so the per-clinic admin can confirm the path is
  // live (and so we can investigate any "Meta said they sent X" disputes).
  after(() =>
    writeAudit({
      clinicId: cred.clinicId,
      action:
        result.status === "inserted"
          ? "meta_leadgen_ingest"
          : "meta_leadgen_dedupe",
      entityKind: "request",
      entityId: result.id,
      diff: { metaLeadId: lead.id, formId: lead.form_id ?? null },
    })
  );

  return result.status;
}

async function fetchLeadFromGraph(
  leadgenId: string,
  pageAccessToken: string
): Promise<GraphLead | null> {
  const url = new URL(
    `https://graph.facebook.com/${env.META_API_VERSION}/${encodeURIComponent(leadgenId)}`
  );
  url.searchParams.set(
    "fields",
    "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data"
  );
  url.searchParams.set("access_token", pageAccessToken);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) {
      // Lead expired (Meta only keeps unread leads ~90 days) or deleted.
      // No retry would help. Acknowledge.
      return null;
    }
    throw new Error(`graph /${leadgenId} http ${res.status}`);
  }
  return (await res.json()) as GraphLead;
}

// ---------------------------------------------------------------
// field_data → LeadInput mapping.
// ---------------------------------------------------------------

interface MappedFields {
  email: string | null;
  fullName: string | null;
  phone: string | null;
  treatmentWish: string | null;
  message: string | null;
}

function mapFieldData(fd: FieldData[]): MappedFields {
  const get = (...names: string[]) => {
    for (const n of names) {
      const f = fd.find(
        (x) => x.name.toLowerCase().replace(/[^a-z0-9]/g, "_") === n
      );
      const v = f?.values?.[0];
      if (v && v.trim().length > 0) return v.trim();
    }
    return null;
  };

  // Meta uses `email`, `full_name`, `phone_number`, plus user-defined custom
  // questions. We map the well-known ones and fold everything else into the
  // message field so the Praxis sees the patient's actual answers.
  const email = get("email", "work_email");
  const fullName = get(
    "full_name",
    "first_name_last_name",
    "name",
    "fullname"
  );
  const phone = get("phone_number", "phone");

  const treatmentWish = get(
    "treatment",
    "behandlung",
    "behandlungswunsch",
    "service",
    "interest"
  );

  // Build a freeform message from any other answers. Skips the well-known
  // fields (already structured) and the cosmetic ones (city, dob, gender —
  // not relevant in the inbox view).
  const SKIP = new Set([
    "email",
    "work_email",
    "full_name",
    "first_name",
    "last_name",
    "first_name_last_name",
    "name",
    "fullname",
    "phone_number",
    "phone",
    "treatment",
    "behandlung",
    "behandlungswunsch",
    "service",
    "interest",
    "city",
    "state",
    "post_code",
    "zip_code",
    "country",
    "dob",
    "date_of_birth",
    "gender",
  ]);
  const extras: string[] = [];
  for (const f of fd) {
    const key = f.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (SKIP.has(key)) continue;
    const v = f.values?.[0];
    if (!v) continue;
    extras.push(`${f.name}: ${v}`);
  }
  const message = extras.length > 0 ? extras.join("\n") : null;

  return { email, fullName, phone, treatmentWish, message };
}

// ---------------------------------------------------------------
// Signature verification.
// ---------------------------------------------------------------

function verifyMetaSignature(
  rawBody: string,
  headerValue: string,
  appSecret: string
): boolean {
  // Meta uses `sha256=<hex>`. Header may also lowercase the hex.
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = headerValue.startsWith("sha256=")
    ? headerValue.slice("sha256=".length)
    : headerValue;
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}
