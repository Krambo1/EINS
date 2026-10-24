import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ARCHIVED_CLINIC_ERASE_DAYS,
  CLICK_ID_RETENTION_DAYS,
  EMAIL_SEND_LOG_RETENTION_DAYS,
  IMPERSONATION_TOKEN_GRACE_DAYS,
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_ERASE_PER_RUN,
  RETENTION_TIME_BUDGET_MS,
  SESSION_GRACE_DAYS,
  SPAM_REQUEST_RETENTION_DAYS,
  UNBOOKED_REQUEST_ANONYMISE_MONTHS,
} from "@/lib/retention";

/**
 * Retention sweep (L-4, decided by Karam 2026-10-07).
 *
 * Runs from the daily Vercel cron (/api/cron/daily, step "purge-retention")
 * and from the worker's weekly purge job (purge-audit.ts calls it). Every
 * rule is a predicate on the current state, so running it twice, or from
 * both runners on the same day, changes nothing the second time.
 *
 *  1. Spam Anfragen older than SPAM_REQUEST_RETENTION_DAYS: deleted.
 *     Dependent rows go with them (request_activities, request_followups,
 *     review_email_schedule, ads_conversion_outbox,
 *     guarantee_candidate_rejections cascade; retreatment_cycles SET NULL).
 *     Kept while they may still be guarantee evidence: the request is the
 *     confirmed qualifying request, or the Praxis has an undecided guarantee
 *     clock signed in the last 180 days.
 *  2. Click identifiers older than CLICK_ID_RETENTION_DAYS: NULL (columns),
 *     removed (same keys inside utm, raw_payload, ai_signals.quiz), and
 *     stripped as query parameters from the stored page URL
 *     quiz.sourceUrl (raw_payload and ai_signals); the rest of the URL stays.
 *  3. Archived Praxis ARCHIVED_CLINIC_ERASE_DAYS after archived_at: full
 *     erase via server/dsgvo.ts, only if a complete DSGVO export taken at or
 *     after archiving is in the audit log. Otherwise one ops alert, no erase.
 *  4. Anfragen without appointment and treatment, older than
 *     UNBOOKED_REQUEST_ANONYMISE_MONTHS: contact data, message, raw payload,
 *     AI reasoning, quiz notes, consent IP and the free text of their
 *     activities/follow-ups become NULL; treatment_wish unless it is a
 *     catalogue name of the Praxis, budget_indication unless it is a fixed
 *     quiz category. Row, status, source, treatment_id, categories and dates
 *     stay, so every count stays.
 *  5. Housekeeping: sessions (expired or revoked + SESSION_GRACE_DAYS),
 *     impersonation tokens (expired + IMPERSONATION_TOKEN_GRACE_DAYS),
 *     email_send_log (> EMAIL_SEND_LOG_RETENTION_DAYS).
 *
 * Batched (RETENTION_BATCH_SIZE rows per statement) under a time budget;
 * whatever is left is picked up by the next run. Logs counts only.
 */

export interface RetentionReport {
  dryRun: boolean;
  spamDeleted: number;
  clickIdsCleared: number;
  requestsAnonymised: number;
  sessionsDeleted: number;
  impersonationTokensDeleted: number;
  emailSendLogDeleted: number;
  archivedClinicsErased: number;
  archivedClinicsBlocked: number;
  /** True when the time budget stopped a rule before it was done. */
  incomplete: boolean;
}

export interface RetentionOptions {
  /** Count only, change nothing. */
  dryRun?: boolean;
  /** Test hook. */
  timeBudgetMs?: number;
  /** Test hook: restrict every rule to these clinics. */
  onlyClinicIds?: string[];
}

/** Click-id keys that also live inside the utm / raw payload bags. */
const CLICK_KEYS = sql.raw(
  `ARRAY['fbclid','gclid','wbraid','gbraid','dclid','msclkid','ttclid','fbc','fbp']::text[]`
);
const COOKIE_KEYS = sql.raw(`ARRAY['fbc','fbp']::text[]`);

/**
 * V1 REFUTED (rule 2): the landing page stores `window.location.href` as
 * quiz.sourceUrl, so the same click ids sit in that URL's query string.
 * One query parameter named like a click id (with or without value),
 * case-insensitive; the separator before it is kept for the cleanup steps.
 */
const CLICK_PARAM_RE =
  "([?&])(fbclid|gclid|wbraid|gbraid|dclid|msclkid|ttclid|fbc|fbp)(=[^&#]*)?(?=[&#]|$)";

/** True when the text expression is a URL that still carries a click id. */
function urlHasClickParam(url: SQL): SQL {
  return sql`(${url}) ~* ${CLICK_PARAM_RE}`;
}

/**
 * The URL without its click-id parameters; everything else (path, other
 * parameters, fragment) stays. "?a=1&fbclid=x#top" -> "?a=1#top",
 * "/?fbclid=x" -> "/".
 */
/** Postgres regexp_replace back-reference to group 1, bound as a parameter. */
const BACKREF_1 = "\\1";

function stripClickParams(url: SQL): SQL {
  return sql`regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace((${url}), ${CLICK_PARAM_RE}, ${BACKREF_1}, 'gi'),
          '&{2,}', '&', 'g'),
        '[?]&', '?', 'g'),
      '[?&]+(#|$)', ${BACKREF_1}, 'g')`;
}

/** `doc` with doc->quiz->sourceUrl stripped, when it is a string carrying a click id. */
function withStrippedSourceUrl(doc: SQL, original: SQL): SQL {
  const url = sql`(${original})->'quiz'->>'sourceUrl'`;
  return sql`CASE
      WHEN jsonb_typeof((${original})->'quiz'->'sourceUrl') = 'string'
           AND ${urlHasClickParam(url)}
      THEN jsonb_set(${doc}, '{quiz,sourceUrl}', to_jsonb(${stripClickParams(url)}))
      ELSE ${doc} END`;
}
const BOOKED_STATUS_LIST = sql.raw(
  `('termin_vereinbart','beratung_erschienen','no_show','behandelt','gewonnen')`
);

/**
 * V1 Neben (rule 4): budget_indication values that are fixed quiz categories
 * (clinic-landing lib/portal-intake.ts BUDGET_LABELS, labels and raw keys).
 * Anything else is free text and becomes NULL at 24 months. Keep in sync.
 */
const BUDGET_CATEGORIES = sql.raw(
  `('Investitionsrahmen passt','Investitionsrahmen unsicher','Möchte erst Informationen','ja','unsicher','erst-informieren')`
);

/**
 * treatment_wish is a category only when it equals (trimmed, case-insensitive)
 * a treatment name of the same Praxis's catalogue; otherwise it is patient
 * free text (Meta form field, up to 500 chars) and becomes NULL at 24 months.
 */
const TREATMENT_WISH_IS_CATALOG = sql`EXISTS (
  SELECT 1 FROM treatments t
  WHERE t.clinic_id = r.clinic_id
    AND lower(btrim(t.name)) = lower(btrim(r.treatment_wish)))`;

function days(n: number): SQL {
  return sql`(${n}::int * interval '1 day')`;
}

/** `column = ANY(ids)`, or TRUE when not restricted. Ids are uuid-checked. */
function clinicFilter(column: string, ids: string[] | undefined): SQL {
  if (!ids) return sql`TRUE`;
  if (ids.length === 0) return sql`FALSE`;
  return sql.raw(
    `${column} = ANY(ARRAY[${ids.map((id) => `'${uuidOnly(id)}'`).join(",")}]::uuid[])`
  );
}

function uuidOnly(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("retention: bad clinic id");
  return id;
}

function affected(result: unknown): number {
  return (
    (result as { count?: number }).count ??
    (result as { rowCount?: number }).rowCount ??
    0
  );
}

async function countOf(query: SQL): Promise<number> {
  const rows = (await db.execute(query)) as unknown as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Predicates (alias r = requests). Shared by the dry-run count and the action.
// ---------------------------------------------------------------------------

function spamPredicate(opts: RetentionOptions): SQL {
  return sql`
    r.status = 'spam'
    AND r.created_at < now() - ${days(SPAM_REQUEST_RETENTION_DAYS)}
    AND NOT EXISTS (
      SELECT 1 FROM guarantee_clocks g WHERE g.qualifying_request_id = r.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM guarantee_clocks g
      WHERE g.clinic_id = r.clinic_id
        AND g.qualifying_inquiry_on IS NULL
        AND g.manual_end_state IS NULL
        AND g.signed_on > (now() - interval '180 days')::date
    )
    AND ${clinicFilter("r.clinic_id", opts.onlyClinicIds)}`;
}

function clickPredicate(opts: RetentionOptions): SQL {
  return sql`
    r.created_at < now() - ${days(CLICK_ID_RETENTION_DAYS)}
    AND (
      r.fbclid IS NOT NULL OR r.gclid IS NOT NULL OR r.wbraid IS NOT NULL
      OR r.gbraid IS NOT NULL OR r.fbc IS NOT NULL OR r.fbp IS NOT NULL
      OR r.click_user_agent IS NOT NULL OR r.click_ip_anon IS NOT NULL
      OR (jsonb_typeof(r.utm) = 'object' AND r.utm ?| ${CLICK_KEYS})
      OR (jsonb_typeof(r.raw_payload) = 'object' AND (
            r.raw_payload ? 'attribution'
            OR (jsonb_typeof(r.raw_payload->'utm') = 'object' AND r.raw_payload->'utm' ?| ${CLICK_KEYS})
            OR (jsonb_typeof(r.raw_payload->'quiz') = 'object' AND r.raw_payload->'quiz' ?| ${COOKIE_KEYS})
         ))
      OR (jsonb_typeof(r.ai_signals->'quiz') = 'object' AND r.ai_signals->'quiz' ?| ${COOKIE_KEYS})
      OR (jsonb_typeof(r.ai_signals->'quiz'->'sourceUrl') = 'string'
          AND ${urlHasClickParam(sql`r.ai_signals->'quiz'->>'sourceUrl'`)})
      OR (jsonb_typeof(r.raw_payload->'quiz'->'sourceUrl') = 'string'
          AND ${urlHasClickParam(sql`r.raw_payload->'quiz'->>'sourceUrl'`)})
    )
    AND ${clinicFilter("r.clinic_id", opts.onlyClinicIds)}`;
}

function unbookedPredicate(opts: RetentionOptions): SQL {
  return sql`
    r.created_at < now() - (${UNBOOKED_REQUEST_ANONYMISE_MONTHS}::int * interval '1 month')
    AND r.status IN ('neu','kontaktiert','nicht_erreicht','verloren')
    AND r.appointment_at IS NULL AND r.completed_at IS NULL
    AND r.no_show_at IS NULL AND r.won_at IS NULL
    AND r.pvs_appointment_id IS NULL AND r.pvs_encounter_id IS NULL
    AND r.converted_revenue_eur IS NULL AND r.patient_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM guarantee_clocks g WHERE g.qualifying_request_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM review_email_schedule s WHERE s.request_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM ads_conversion_outbox o WHERE o.request_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM retreatment_cycles c WHERE c.request_id = r.id)
    AND NOT EXISTS (
      SELECT 1 FROM request_activities a
      WHERE a.request_id = r.id AND a.kind = 'status_change'
        AND (a.meta->>'source' = 'pvs'
             OR a.meta->>'to' IN ${BOOKED_STATUS_LIST}
             OR a.meta->>'derivedStatus' IN ${BOOKED_STATUS_LIST})
    )
    AND (
      r.contact_name IS NOT NULL OR r.contact_email IS NOT NULL
      OR r.contact_phone IS NOT NULL OR r.message IS NOT NULL
      OR r.raw_payload IS NOT NULL OR r.ai_reasoning IS NOT NULL
      OR r.dsgvo_consent_ip IS NOT NULL
      OR (jsonb_typeof(r.ai_signals->'quiz') = 'object' AND r.ai_signals->'quiz' ? 'notes')
      OR (r.treatment_wish IS NOT NULL AND NOT ${TREATMENT_WISH_IS_CATALOG})
      OR (r.budget_indication IS NOT NULL AND r.budget_indication NOT IN ${BUDGET_CATEGORIES})
    )
    AND ${clinicFilter("r.clinic_id", opts.onlyClinicIds)}`;
}

// ---------------------------------------------------------------------------

export async function processPurgeRetention(
  opts: RetentionOptions = {}
): Promise<RetentionReport> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? RETENTION_TIME_BUDGET_MS;
  const report: RetentionReport = {
    dryRun: opts.dryRun === true,
    spamDeleted: 0,
    clickIdsCleared: 0,
    requestsAnonymised: 0,
    sessionsDeleted: 0,
    impersonationTokensDeleted: 0,
    emailSendLogDeleted: 0,
    archivedClinicsErased: 0,
    archivedClinicsBlocked: 0,
    incomplete: false,
  };
  const outOfTime = () => Date.now() - started >= budget;

  /** Run one batched statement until it touches fewer rows than a batch. */
  async function drain(stmt: SQL): Promise<number> {
    let total = 0;
    for (;;) {
      if (outOfTime()) {
        report.incomplete = true;
        return total;
      }
      const n = affected(await db.execute(stmt));
      total += n;
      if (n < RETENTION_BATCH_SIZE) return total;
    }
  }

  const B = RETENTION_BATCH_SIZE;

  // 1. Spam ---------------------------------------------------------------
  const spam = spamPredicate(opts);
  report.spamDeleted = report.dryRun
    ? await countOf(sql`SELECT count(*) AS n FROM requests r WHERE ${spam}`)
    : await drain(sql`
        DELETE FROM requests WHERE id IN (
          SELECT r.id FROM requests r WHERE ${spam} LIMIT ${B}
        )`);

  // 2. Click identifiers --------------------------------------------------
  const click = clickPredicate(opts);
  report.clickIdsCleared = report.dryRun
    ? await countOf(sql`SELECT count(*) AS n FROM requests r WHERE ${click}`)
    : await drain(sql`
        UPDATE requests r SET
          fbclid = NULL, gclid = NULL, wbraid = NULL, gbraid = NULL,
          fbc = NULL, fbp = NULL, click_user_agent = NULL, click_ip_anon = NULL,
          utm = CASE WHEN jsonb_typeof(r.utm) = 'object' THEN r.utm - ${CLICK_KEYS} ELSE r.utm END,
          raw_payload = CASE WHEN jsonb_typeof(r.raw_payload) = 'object' THEN
              ${withStrippedSourceUrl(
                sql`CASE WHEN jsonb_typeof(r.raw_payload->'utm') = 'object'
                   THEN jsonb_set(r.raw_payload, '{utm}', (r.raw_payload->'utm') - ${CLICK_KEYS})
                   ELSE r.raw_payload END`,
                sql`r.raw_payload`
              )}
                - 'attribution' #- '{quiz,fbc}' #- '{quiz,fbp}'
            ELSE r.raw_payload END,
          ai_signals = CASE WHEN jsonb_typeof(r.ai_signals->'quiz') = 'object'
            THEN ${withStrippedSourceUrl(sql`r.ai_signals`, sql`r.ai_signals`)}
                 #- '{quiz,fbc}' #- '{quiz,fbp}'
            ELSE r.ai_signals END
        WHERE r.id IN (SELECT r.id FROM requests r WHERE ${click} LIMIT ${B})`);

  // 3. Archived Praxen ----------------------------------------------------
  await purgeArchivedClinics(opts, report, outOfTime);

  // 4. Unbooked Anfragen after 24 months ------------------------------------
  const unbooked = unbookedPredicate(opts);
  report.requestsAnonymised = report.dryRun
    ? await countOf(sql`SELECT count(*) AS n FROM requests r WHERE ${unbooked}`)
    : await drain(sql`
        WITH batch AS (
          SELECT r.id FROM requests r WHERE ${unbooked} LIMIT ${B} FOR UPDATE SKIP LOCKED
        ),
        acts AS (
          UPDATE request_activities SET body = NULL
          WHERE request_id IN (SELECT id FROM batch) AND body IS NOT NULL
        ),
        fups AS (
          UPDATE request_followups SET note = NULL
          WHERE request_id IN (SELECT id FROM batch) AND note IS NOT NULL
        )
        UPDATE requests r SET
          contact_name = NULL, contact_email = NULL, contact_phone = NULL,
          message = NULL, raw_payload = NULL, ai_reasoning = NULL,
          dsgvo_consent_ip = NULL,
          treatment_wish = CASE WHEN ${TREATMENT_WISH_IS_CATALOG} THEN r.treatment_wish ELSE NULL END,
          budget_indication = CASE WHEN r.budget_indication IN ${BUDGET_CATEGORIES}
            THEN r.budget_indication ELSE NULL END,
          ai_signals = CASE WHEN jsonb_typeof(r.ai_signals->'quiz') = 'object'
            THEN r.ai_signals #- '{quiz,notes}' ELSE r.ai_signals END
        WHERE r.id IN (SELECT id FROM batch)`);

  // 5. Housekeeping (platform-wide, skipped when restricted to clinics) ----
  if (!opts.onlyClinicIds) {
    const sessionPred = sql`
      (expires_at < now() - ${days(SESSION_GRACE_DAYS)}
       OR revoked_at < now() - ${days(SESSION_GRACE_DAYS)})`;
    report.sessionsDeleted = report.dryRun
      ? await countOf(sql`SELECT count(*) AS n FROM sessions WHERE ${sessionPred}`)
      : await drain(sql`
          DELETE FROM sessions WHERE id IN (
            SELECT id FROM sessions WHERE ${sessionPred} LIMIT ${B}
          )`);

    const impPred = sql`expires_at < now() - ${days(IMPERSONATION_TOKEN_GRACE_DAYS)}`;
    report.impersonationTokensDeleted = report.dryRun
      ? await countOf(sql`SELECT count(*) AS n FROM impersonation_tokens WHERE ${impPred}`)
      : await drain(sql`
          DELETE FROM impersonation_tokens WHERE id IN (
            SELECT id FROM impersonation_tokens WHERE ${impPred} LIMIT ${B}
          )`);

    const logPred = sql`sent_at < now() - ${days(EMAIL_SEND_LOG_RETENTION_DAYS)}`;
    report.emailSendLogDeleted = report.dryRun
      ? await countOf(sql`SELECT count(*) AS n FROM email_send_log WHERE ${logPred}`)
      : await drain(sql`
          DELETE FROM email_send_log WHERE idempotency_key IN (
            SELECT idempotency_key FROM email_send_log WHERE ${logPred} LIMIT ${B}
          )`);
  }

  console.log(JSON.stringify({ kind: "retention", ...report, ms: Date.now() - started }));
  return report;
}

/** Ops-alert scope for "archived Praxis waits for its export" (sent once). */
export function retentionBlockedAlertKind(): string {
  return "retention_erase_blocked:no_export";
}

async function purgeArchivedClinics(
  opts: RetentionOptions,
  report: RetentionReport,
  outOfTime: () => boolean
): Promise<void> {
  const due = (await db.execute(sql`
    SELECT c.id, c.slug, c.display_name AS "displayName", c.archived_at AS "archivedAt",
      EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.clinic_id = c.id
          AND a.entity_kind = 'dsgvo_export'
          AND a.diff->>'status' = 'complete'
          AND a.created_at >= c.archived_at
      ) AS "exported"
    FROM clinics c
    WHERE c.archived_at IS NOT NULL
      AND c.archived_at < now() - ${days(ARCHIVED_CLINIC_ERASE_DAYS)}
      AND ${clinicFilter("c.id", opts.onlyClinicIds)}
    ORDER BY c.archived_at
  `)) as unknown as Array<{
    id: string;
    slug: string;
    displayName: string;
    archivedAt: Date;
    exported: boolean;
  }>;

  const ready = due.filter((c) => c.exported);
  const blocked = due.filter((c) => !c.exported);
  report.archivedClinicsBlocked = blocked.length;

  if (report.dryRun) {
    report.archivedClinicsErased = ready.length;
    return;
  }

  // Missing export: tell ops once per Praxis (ops_alert_log row = sent).
  if (blocked.length > 0) {
    const { notifyOps, opsAlertScopeKey } = await import("@/server/ops-alerts");
    for (const c of blocked) {
      const kind = retentionBlockedAlertKind();
      const scope = opsAlertScopeKey({ clinicId: c.id, kind });
      const [already] = (await db.execute(
        sql`SELECT 1 AS x FROM ops_alert_log WHERE scope_key = ${scope}`
      )) as unknown as unknown[];
      if (already) continue;
      await notifyOps({
        clinicId: c.id,
        kind,
        severity: "high",
        title: "Archivierte Praxis: Löschung wartet auf DSGVO-Export",
        body:
          `Die Praxis ist seit mehr als ${ARCHIVED_CLINIC_ERASE_DAYS} Tagen archiviert und wird automatisch gelöscht, ` +
          "sobald ein vollständiger DSGVO-Export nach der Archivierung protokolliert ist. " +
          "Bitte im Admin unter Praxis, DSGVO den Export herunterladen und der Praxis bereitstellen. " +
          "Bis dahin wird nichts gelöscht. Diese Nachricht kommt nur einmal.",
      });
    }
  }

  if (ready.length === 0) return;
  const { eraseClinicData } = await import("@/server/dsgvo");
  for (const c of ready.slice(0, RETENTION_MAX_ERASE_PER_RUN)) {
    if (outOfTime()) {
      report.incomplete = true;
      return;
    }
    try {
      await eraseClinicData(c.id, {
        email: "system:aufbewahrung",
        slug: c.slug,
        displayName: c.displayName,
      });
      report.archivedClinicsErased += 1;
    } catch (err) {
      report.incomplete = true;
      console.error(
        `[retention] erase failed clinic=${c.id}:`,
        err instanceof Error ? err.name : "unknown"
      );
    }
  }
  if (ready.length > RETENTION_MAX_ERASE_PER_RUN) report.incomplete = true;
}
