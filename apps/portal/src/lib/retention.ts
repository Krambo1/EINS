/**
 * Retention periods (L-4, decided by Karam 2026-10-07). Applied by
 * `worker/processors/purge-retention.ts`, which runs from the daily Vercel
 * cron (/api/cron/daily) and from the worker's weekly purge job.
 *
 * Changing a number here changes what the next nightly run deletes. Shorter
 * is irreversible for rows that already fall outside the new window.
 */

/** Anfragen with status 'spam' are deleted (with dependent rows) after this. */
export const SPAM_REQUEST_RETENTION_DAYS = 90;

/**
 * Ad click identifiers (fbclid, gclid, wbraid, gbraid, fbc, fbp, click user
 * agent, anonymised click IP, and the same keys inside utm / raw_payload /
 * ai_signals) are cleared this long after the Anfrage arrived. Matches the
 * 90-day attribution window of Meta and Google.
 */
export const CLICK_ID_RETENTION_DAYS = 90;

/**
 * An archived Praxis is erased (server/dsgvo.ts) this long after
 * `clinics.archived_at`, but only once a complete DSGVO export taken after
 * the archiving is recorded in the audit log. Without it: ops alert, no erase.
 */
export const ARCHIVED_CLINIC_ERASE_DAYS = 90;

/**
 * Anfragen that never got an appointment or a treatment are anonymised this
 * long after arrival: contact data and free text become NULL, the row and its
 * counts (source, status, treatment, dates) stay.
 */
export const UNBOOKED_REQUEST_ANONYMISE_MONTHS = 24;

/** Sessions are deleted this long after they expired or were revoked. */
export const SESSION_GRACE_DAYS = 30;

/** Impersonation handoff tokens are deleted this long after expiry. */
export const IMPERSONATION_TOKEN_GRACE_DAYS = 7;

/** email_send_log ledger rows (no patient data) are kept this long. */
export const EMAIL_SEND_LOG_RETENTION_DAYS = 90;

/** Rows per statement; keeps each lock and WAL burst small. */
export const RETENTION_BATCH_SIZE = 500;

/** Archived Praxen erased per run at most (an erase is a large transaction). */
export const RETENTION_MAX_ERASE_PER_RUN = 3;

/** Stop starting new batches after this long; the next run continues. */
export const RETENTION_TIME_BUDGET_MS = 90_000;
