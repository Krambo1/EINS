import { NextResponse, after, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, hasMeta } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import { persistLead, ClinicArchivedError, buildMetaConsents } from "@/server/leads";
import { META_PAGE_ERRORS, findCredentialByMetaPageId } from "@/server/meta-pages";
import { notifyOps } from "@/server/ops-alerts";
import { rateLimit } from "@/server/rate-limit";

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

export const runtime = "nodejs";
// Graph fetch (8 s) per lead plus persistLead; the AI score and the
// "Neue Anfrage" mail run in after() inside the same budget (K-5).
export const maxDuration = 60;

// ---------------------------------------------------------------
// GET — webhook verification (Meta hits this on subscribe).
// ---------------------------------------------------------------

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = env.META_LEADGEN_VERIFY_TOKEN;
  if (!expectedToken) {
    return new NextResponse("not configured", { status: 503 });
  }

  // Constant-time compare so the verify-token can't be recovered byte-by-byte
  // via timing (pentest I2). timingSafeEqual throws on a length mismatch, so
  // length-gate first.
  const tokenOk =
    typeof token === "string" &&
    token.length === expectedToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));

  if (mode === "subscribe" && tokenOk && challenge) {
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

  // Process each entry. If ANY lead could not be stored for a reason a retry
  // can fix (DB error, Graph 5xx, expired/revoked page token, rate limit),
  // answer 500 so Meta redelivers the batch. Redelivery is safe: the unique
  // index (clinic_id, meta_lead_id) turns already-stored leads into
  // "deduped", and the new-request email is claimed once per row (C-9).
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
          err instanceof Error ? err.message : err
        );
        results.push({ leadgenId, status: "error" });
        // Page bound to several Praxen (J-1): the lead is NOT stored (500,
        // Meta redelivers) until someone fixes the binding. Tell ops.
        if (err instanceof Error && err.message === META_PAGE_ERRORS.ambiguousBinding) {
          await notifyOps({
            clinicId: null,
            kind: `meta_page_ambiguous:${pageId}`,
            severity: "high",
            title: "Meta-Anfrage nicht zugeordnet: Seite an mehreren Praxen",
            body:
              `Die Facebook-Seite ${pageId} ist mit mehr als einer Praxis verbunden. ` +
              "Eingehende Anfragen dieser Seite werden nicht gespeichert, bis nur noch eine Praxis mit ihr verbunden ist. " +
              "Meta liefert sie danach erneut aus.",
          });
        }
      }
    }
  }

  const retry = results.some((r) => r.status === "error" || r.status === "rate_limited");
  if (retry) {
    return NextResponse.json(
      { ok: false, processed: results.length, results },
      { status: 500 }
    );
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
): Promise<
  "inserted" | "deduped" | "unbound_page" | "clinic_archived" | "missing_lead" | "rate_limited"
> {
  const cred = await findCredentialByMetaPageId(pageId);
  if (!cred) {
    // Webhook from a Page no clinic owns — happens when a Praxis disconnects
    // but Meta still has an active subscription. Log so we can clean up the
    // subscription on Meta's side, but acknowledge.
    console.warn(`[meta-leadgen] no clinic bound to page=${pageId}`);
    return "unbound_page";
  }

  // Bound the paid Graph egress: a replayed/duplicated webhook (no timestamp in
  // the X-Hub scheme) must not drive unbounded fetchLeadFromGraph calls
  // (pentest M7 / BR-04-meta). 100/min per clinic is far above any real lead
  // rate; when it trips, the batch gets a 500 so Meta redelivers later.
  const rl = await rateLimit("meta-leadgen", cred.clinicId, {
    limit: 100,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    console.warn(`[meta-leadgen] rate-limited clinic=${cred.clinicId}`);
    return "rate_limited";
  }

  const lead = await fetchLeadFromGraph(value.leadgen_id, cred.pageAccessToken);
  if (!lead) return "missing_lead";

  const fields = mapFieldData(lead.field_data ?? []);
  let result: Awaited<ReturnType<typeof persistLead>>;
  try {
    result = await persistLead(cred.clinicId, {
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
      // Consent record (L-6): Meta's own form text, identified by form id;
      // consent time = when the person submitted the form on Meta.
      consentAt: metaCreatedAt(lead.created_time ?? null, value.created_time),
      consents: buildMetaConsents({
        at: metaCreatedAt(lead.created_time ?? null, value.created_time) ?? new Date(),
        formId: lead.form_id ?? value.form_id ?? null,
      }),
    });
  } catch (err) {
    if (err instanceof ClinicArchivedError) {
      // Contract ended; a retry would not help. Ack and log so the Meta
      // subscription can be removed.
      console.warn(`[meta-leadgen] clinic archived clinic=${cred.clinicId} page=${pageId}`);
      return "clinic_archived";
    }
    throw err;
  }

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

  // Meta never asks persistLead for the same-contact merge, so "same_contact"
  // cannot occur here; it would still be a dedupe.
  return result.status === "inserted" ? "inserted" : "deduped";
}

/** Graph `created_time` (ISO with +0000) or webhook `created_time` (unix s). */
function metaCreatedAt(iso: string | null, unix: number | undefined): Date | null {
  if (iso) {
    const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof unix === "number" && Number.isFinite(unix)) return new Date(unix * 1000);
  return null;
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
  // Token in the header, never in the URL (URLs end up in logs and traces).
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${pageAccessToken}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    // Only "this lead does not exist (any more)" is acknowledged: HTTP 404,
    // or Graph error 100 / subcode 33 (Meta keeps leads ~90 days). Anything
    // else, above all code 190 (expired or revoked page token), throws so
    // the batch gets a 500 and Meta redelivers once the token is fixed (C-9).
    let code: number | null = null;
    let subcode: number | null = null;
    try {
      const body = (await res.json()) as {
        error?: { code?: number; error_subcode?: number };
      };
      code = body.error?.code ?? null;
      subcode = body.error?.error_subcode ?? null;
    } catch {
      // Non-JSON error body: treat as retryable.
    }
    if (res.status === 404 || (code === 100 && subcode === 33)) return null;
    if (code === 190) {
      console.error(
        `[meta-leadgen] page access token rejected (code 190) leadgen=${leadgenId}; reconnect Meta for this Praxis`
      );
    }
    throw new Error(`graph /${leadgenId} http ${res.status} code ${code ?? "?"}`);
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
