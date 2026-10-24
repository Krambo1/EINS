import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env, adminOrigin } from "@/lib/env";
import { SOURCE_LABELS, type RequestSource } from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import { MESSWEG_LABELS, classifyAttribution, isFrontDeskSource } from "@/lib/sources";
import { buildBrandedEmailHtml, getEmailSender, type SendEmailInput } from "@/server/email";
import { isEmailSuppressed } from "@/server/email-suppression";
import { CLAIM_STALE_MINUTES } from "@/server/email-once";
import { describeErrorForLog } from "@/lib/error-log";
import {
  renderFirstInquiryCandidateText,
  renderNewRequestEmail,
} from "@/server/email/templates/new-request";

/**
 * "Neue Anfrage" notification (portal review C-5 / E-05 / H-05, C-6 / H-08).
 *
 * Every new request row gets exactly one email to the Praxis team: active
 * (non-archived) users with role inhaber or frontdesk, minus addresses on
 * the suppression list. Sent inline after the response via `after()`, never
 * through the pg-boss queue (the worker is off in production).
 *
 * Exactly once: `requests.new_request_notified_at` (migration 0087) is the
 * CLAIM, taken with a conditional UPDATE before anything is sent. A Meta
 * webhook retry, a second instance or a duplicate call finds a fresh claim
 * and does nothing. `new_request_delivered_at` (0094) is set only once at
 * least one mail was accepted (or there is nothing left to do: archived
 * Praxis). A claim older than CLAIM_STALE_MINUTES without delivery (function
 * died between claim and send, or no recipient yet) can be taken again by
 * the morning catch-up; the Resend Idempotency-Keys are identical on every
 * retry. If not a single mail could be sent, the claim is released at once.
 *
 * The mail never contains patient data (see templates/new-request.ts).
 * Failures are logged with the request id only and never reach the caller.
 */

export const NOTIFY_ROLES = ["inhaber", "frontdesk"] as const;

export interface ClaimedRequest {
  id: string;
  clinicId: string;
  clinicName: string;
  clinicArchived: boolean;
  source: string;
  treatmentWish: string | null;
  quizTreatment: string | null;
  /** L-13: name of the Praxis's catalogue entry (requests.treatment_id), or null. */
  catalogTreatment?: string | null;
  /** L-13 (H2): names of this Praxis's active catalogue treatments. */
  catalogNames?: string[];
  createdAt: Date;
}

export interface CandidateUser {
  email: string;
  role: string;
  archivedAt: Date | null;
}

export interface NotifyDeps {
  claim(requestId: string): Promise<ClaimedRequest | null>;
  release(requestId: string): Promise<void>;
  /** Mark the claim as done; only after the provider accepted a mail. */
  markDelivered(requestId: string): Promise<void>;
  loadUsers(clinicId: string): Promise<CandidateUser[]>;
  isSuppressed(clinicId: string, email: string): Promise<boolean>;
  send(input: SendEmailInput): Promise<void>;
  portalOrigin(): string;
  /** Operator check for the first-invoice candidate. Optional side path. */
  operatorCandidate?(req: ClaimedRequest): Promise<void>;
}

export interface NotifyOutcome {
  status: "already_notified" | "no_recipients" | "own_entry" | "sent" | "all_failed";
  sent: number;
  failed: number;
}

/**
 * Pure recipient selection: active inhaber/frontdesk users, one entry per
 * address (case-insensitive), suppressed addresses removed.
 */
export function selectRecipients(
  users: CandidateUser[],
  suppressed: ReadonlySet<string>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of users) {
    if (u.archivedAt) continue;
    if (!(NOTIFY_ROLES as readonly string[]).includes(u.role)) continue;
    const email = u.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    if (suppressed.has(email)) continue;
    out.push(email);
  }
  return out;
}

/**
 * Recipient of operator mails (Karam): OPS_ALERT_EMAIL, else the first
 * ADMIN_EMAILS entry. `adminEmails` is typed `unknown` on purpose: with
 * SKIP_ENV_VALIDATION=1 (tests, scripts) `env.ADMIN_EMAILS` is the raw env
 * value (undefined or a comma string), not the parsed array, and indexing it
 * blindly threw "reading '0'" or picked the first character.
 */
export function operatorRecipient(
  opsAlertEmail: string | undefined,
  adminEmails: unknown
): string | null {
  const ops = opsAlertEmail?.trim();
  if (ops) return ops;
  const list = Array.isArray(adminEmails)
    ? adminEmails
    : typeof adminEmails === "string"
      ? adminEmails.split(",")
      : [];
  for (const e of list) {
    const v = typeof e === "string" ? e.trim().toLowerCase() : "";
    if (v) return v;
  }
  return null;
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * L-13 (DECISIONS H2, strict variant): the mail may name a treatment only
 * when it is the Praxis's catalogue entry (requests.treatment_id) or when the
 * free text / quiz selection equals (case-insensitive, trimmed) the name of an
 * active catalogue treatment of that Praxis; then the catalogue spelling is
 * used. Everything else (e.g. a bare patient name) gives no label, so the
 * subject stays "Neue Anfrage über EINS".
 */
export function resolveTreatmentLabel(
  req: Pick<ClaimedRequest, "catalogTreatment" | "treatmentWish" | "quizTreatment" | "catalogNames">
): { label: string | null; fromCatalog: boolean } {
  if (req.catalogTreatment) return { label: req.catalogTreatment, fromCatalog: true };
  const names = req.catalogNames ?? [];
  for (const candidate of [req.treatmentWish, req.quizTreatment]) {
    if (!candidate) continue;
    const wanted = normalizeLabel(candidate);
    if (!wanted) continue;
    const match = names.find((n) => normalizeLabel(n) === wanted);
    if (match) return { label: match, fromCatalog: true };
  }
  return { label: null, fromCatalog: false };
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as RequestSource] ?? "Sonstige Quelle";
}

/** Run the notification for one request. Never throws. */
export async function runNewRequestNotification(
  requestId: string,
  deps: NotifyDeps
): Promise<NotifyOutcome> {
  const req = await deps.claim(requestId);
  if (!req) return { status: "already_notified", sent: 0, failed: 0 };

  // Operator mail is independent of the Praxis mail; its failure is logged
  // and ignored.
  if (deps.operatorCandidate && !req.clinicArchived) {
    try {
      await deps.operatorCandidate(req);
    } catch (err) {
      console.error(
        `[request-notify] operator candidate check failed request=${requestId}:`,
        JSON.stringify(describeErrorForLog(err))
      );
    }
  }

  if (req.clinicArchived) {
    await markDeliveredSafe(deps, requestId);
    return { status: "no_recipients", sent: 0, failed: 0 };
  }

  // The Praxis entered this Anfrage itself at the front desk: no "Neue
  // Anfrage" mail to the people who just typed it. Marked delivered so the
  // morning catch-up does not send it later either.
  if (isFrontDeskSource(req.source)) {
    await markDeliveredSafe(deps, requestId);
    return { status: "own_entry", sent: 0, failed: 0 };
  }

  const users = await deps.loadUsers(req.clinicId);
  const suppressed = new Set<string>();
  for (const u of users) {
    const email = u.email.trim().toLowerCase();
    if (email && (await deps.isSuppressed(req.clinicId, email))) suppressed.add(email);
  }
  const recipients = selectRecipients(users, suppressed);
  if (recipients.length === 0) {
    // The claim stays undelivered: once it is stale, the morning catch-up
    // (25 h window) tries again, e.g. after a user was invited.
    console.warn(`[request-notify] no recipients clinic=${req.clinicId} request=${requestId}`);
    return { status: "no_recipients", sent: 0, failed: 0 };
  }

  const treatment = resolveTreatmentLabel(req);
  const mail = renderNewRequestEmail({
    clinicName: req.clinicName,
    // L-13 (H2, strict): only a name from this Praxis's catalogue ever reaches
    // subject or body; anything else gives the generic subject.
    treatment: treatment.label,
    treatmentFromCatalog: treatment.fromCatalog,
    sourceLabel: sourceLabel(req.source),
    receivedAtLabel: formatDateTime(req.createdAt),
    link: `${deps.portalOrigin().replace(/\/$/, "")}/anfragen/${encodeURIComponent(req.id)}`,
  });

  let sent = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      await deps.send({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: `new-request/${req.id}/${createHash("sha256").update(to).digest("hex").slice(0, 16)}`,
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[request-notify] send failed request=${requestId}:`,
        JSON.stringify(describeErrorForLog(err))
      );
    }
  }

  if (sent === 0) {
    await deps.release(requestId).catch(() => undefined);
    return { status: "all_failed", sent, failed };
  }
  await markDeliveredSafe(deps, requestId);
  return { status: "sent", sent, failed };
}

/**
 * A failed bookkeeping write only means the claim goes stale and the morning
 * catch-up re-sends with the same Idempotency-Keys (Resend drops the copy
 * within 24 h). Never throws.
 */
async function markDeliveredSafe(deps: NotifyDeps, requestId: string): Promise<void> {
  try {
    await deps.markDelivered(requestId);
  } catch (err) {
    console.error(
      `[request-notify] delivered mark failed request=${requestId}:`,
      JSON.stringify(describeErrorForLog(err))
    );
  }
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

type ClaimRow = {
  id: string;
  clinic_id: string;
  clinic_name: string;
  clinic_archived: boolean;
  source: string;
  treatment_wish: string | null;
  quiz_treatment: string | null;
  catalog_treatment: string | null;
  catalog_names: string[] | null;
  created_at: Date | string;
};

/** Production dependencies; exported for the opt-in DB test only. */
export const defaultDeps: NotifyDeps = {
  async claim(requestId) {
    const rows = (await db.execute(sql`
      UPDATE requests r
         SET new_request_notified_at = now()
        FROM clinics c
       WHERE r.id = ${requestId}
         AND c.id = r.clinic_id
         AND r.new_request_delivered_at IS NULL
         AND (r.new_request_notified_at IS NULL
              OR r.new_request_notified_at
                 < now() - (${CLAIM_STALE_MINUTES}::int * interval '1 minute'))
      RETURNING r.id, r.clinic_id, c.display_name AS clinic_name,
                (c.archived_at IS NOT NULL) AS clinic_archived,
                r.source, r.treatment_wish,
                r.ai_signals #>> '{quiz,treatmentSelection}' AS quiz_treatment,
                (SELECT t.name FROM treatments t
                  WHERE t.id = r.treatment_id AND t.clinic_id = r.clinic_id) AS catalog_treatment,
                (SELECT coalesce(array_agg(t.name), '{}') FROM treatments t
                  WHERE t.clinic_id = r.clinic_id AND t.is_active) AS catalog_names,
                r.created_at
    `)) as unknown as ClaimRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      clinicId: row.clinic_id,
      clinicName: row.clinic_name,
      clinicArchived: Boolean(row.clinic_archived),
      source: row.source,
      treatmentWish: row.treatment_wish,
      quizTreatment: row.quiz_treatment,
      catalogTreatment: row.catalog_treatment,
      catalogNames: Array.isArray(row.catalog_names) ? row.catalog_names : [],
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    };
  },
  async release(requestId) {
    await db.execute(sql`
      UPDATE requests SET new_request_notified_at = NULL
       WHERE id = ${requestId} AND new_request_delivered_at IS NULL
    `);
  },
  async markDelivered(requestId) {
    await db.execute(sql`
      UPDATE requests SET new_request_delivered_at = now() WHERE id = ${requestId}
    `);
  },
  async loadUsers(clinicId) {
    const rows = (await db.execute(sql`
      SELECT email::text AS email, role, archived_at
        FROM clinic_users
       WHERE clinic_id = ${clinicId}
         AND archived_at IS NULL
         AND role IN ('inhaber', 'frontdesk')
    `)) as unknown as Array<{ email: string; role: string; archived_at: Date | null }>;
    return rows.map((r) => ({ email: r.email, role: r.role, archivedAt: r.archived_at }));
  },
  async isSuppressed(clinicId, email) {
    return (await isEmailSuppressed(clinicId, email, "transactional")) !== null;
  },
  send: (input) => getEmailSender().send(input),
  portalOrigin: () => env.APP_ORIGIN,
  operatorCandidate: notifyOperatorIfFirstInquiryCandidate,
};

/**
 * C-6 / H-08: tell Karam when a Messweg inquiry arrives while the Praxis's
 * guarantee clock is undecided. Uses the same eligibility rules as
 * /admin/garantie (getClinicGuarantee), so the mail fires exactly when the
 * admin page would show this request as a candidate.
 */
async function notifyOperatorIfFirstInquiryCandidate(req: ClaimedRequest): Promise<void> {
  const to = operatorRecipient(process.env.OPS_ALERT_EMAIL, env.ADMIN_EMAILS);
  if (!to) {
    // K-9: never silent. No patient data in the log, only ids.
    console.warn(
      `[request-notify] OPS_ALERT_EMAIL and ADMIN_EMAILS are empty: first-inquiry check not mailed (clinic=${req.clinicId} request=${req.id})`
    );
    return;
  }
  const { getClinicGuarantee } = await import("@/server/guarantee-clock");
  const g = await getClinicGuarantee(req.clinicId);
  if (!g || g.confirmed) return;
  // K-9: a Messweg inquiry at a Praxis without a signing date has no clock,
  // so it can never become a candidate. Tell Karam instead of staying silent.
  if (!g.clock) {
    if (req.clinicArchived || !classifyAttribution({ source: req.source, utm: null }).messweg) return;
    const adminLink = `${adminOrigin()}/admin/garantie/${encodeURIComponent(req.clinicId)}`;
    const text = [
      `Bei ${req.clinicName} ist eine Anfrage über einen EINS-Messweg eingegangen, aber für die Praxis ist kein Unterschriftsdatum eingetragen.`,
      "",
      `Eingang: ${formatDateTime(req.createdAt)} Uhr`,
      "",
      "Ohne Unterschriftsdatum läuft keine 90-Tage-Frist, und die Anfrage kann nicht als erste qualifizierte Anfrage geprüft werden. Bitte das Datum auf der Garantie-Seite eintragen.",
      "",
      `Garantie-Seite: ${adminLink}`,
    ].join("\n");
    await getEmailSender().send({
      to,
      subject: `Praxis hat kein Unterschriftsdatum: ${req.clinicName}`,
      text,
      html: buildBrandedEmailHtml(text),
      idempotencyKey: `first-inquiry-no-clock/${req.id}`,
    });
    return;
  }
  const match = g.eligible.find((e) => e.row.id === req.id);
  if (!match || !match.attribution.messweg) return;
  // K-2: without phone or e-mail the inquiry cannot qualify; no "prüfen" mail.
  if (!match.hasContactData) return;
  const { subject, text } = renderFirstInquiryCandidateText({
    clinicName: req.clinicName,
    messwegLabel: MESSWEG_LABELS[match.attribution.messweg],
    receivedAtLabel: formatDateTime(req.createdAt),
    adminLink: `${adminOrigin()}/admin/garantie/${encodeURIComponent(req.clinicId)}`,
  });
  await getEmailSender().send({
    to,
    subject,
    text,
    html: buildBrandedEmailHtml(text),
    idempotencyKey: `first-inquiry-candidate/${req.id}`,
  });
}

/** Run with the production dependencies. Never throws. */
export async function notifyNewRequest(requestId: string): Promise<NotifyOutcome | null> {
  try {
    return await runNewRequestNotification(requestId, defaultDeps);
  } catch (err) {
    console.error(
      `[request-notify] failed request=${requestId}:`,
      JSON.stringify(describeErrorForLog(err))
    );
    return null;
  }
}

/**
 * Schedule the notification after the HTTP response (Next `after()`), so the
 * intake answer never waits on, or fails because of, email delivery. Outside
 * a request scope (scripts) it runs fire-and-forget.
 */
export function scheduleNewRequestNotification(requestId: string): void {
  const run = async () => {
    await notifyNewRequest(requestId);
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
