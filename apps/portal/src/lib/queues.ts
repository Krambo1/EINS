/**
 * BullMQ queue names — shared between the producer (`src/server/jobs.ts`,
 * which is `server-only`) and the worker entry points under `src/worker/*`,
 * which run as plain Node scripts via `tsx` and cannot import `server-only`.
 */
export const QUEUES = {
  aiScore: "ai-score",
  syncMeta: "sync-meta",
  syncGoogle: "sync-google",
  kpiRebuild: "kpi-rebuild",
  slaCheck: "sla-check",
  monthlyReport: "monthly-report",
  refreshOauth: "refresh-oauth",
  dbBackup: "db-backup",
  purgeAudit: "purge-audit",
  emailSend: "email-send",
  /** EINS Bewertungen — 15-min scanner that emails due review_requests. */
  reviewRequestTick: "review-request-tick",
  /** Daily pull of rating + count from Google Places API. */
  syncReviewsGoogle: "sync-reviews-google",
  /** Daily scrape of rating + count from Jameda profile JSON-LD. */
  syncReviewsJameda: "sync-reviews-jameda",
  /** PVS Bridge — derive requests.status + revenue from event-log replay. */
  pvsStatusDerive: "pvs-status-derive",
  /** PVS Bridge — apps/bridge adapter poll scheduler tick. */
  pvsAdapterPoll: "pvs-adapter-poll",
  /** PVS Bridge — process an uploaded CSV file into canonical events. */
  pvsCsvIngest: "pvs-csv-ingest",
  /** PVS Bridge — re-run Stage 3 fuzzy linker for a single PVS patient id. */
  pvsLinkBackfill: "pvs-link-backfill",
  /**
   * PVS Bridge — Direction A: write the EINS-Lead-{prefix} token into the
   * PVS bemerkung field when a new lead arrives. Adapter-specific; for
   * non-write-capable adapters this is a no-op and the token is surfaced
   * only in the portal UI for MFA copy-paste.
   */
  pvsLeadTokenWrite: "pvs-lead-token-write",
  /** PVS Bridge — monthly partition rotation for pvs_event_log. */
  pvsPartitionRotate: "pvs-partition-rotate",
  /** PVS Bridge — nightly reconciliation: diff expected vs ingested events. */
  pvsReconcile: "pvs-reconcile",
  /** PVS Bridge — trigram-based treatment auto-mapping suggestions. */
  pvsTreatmentSuggest: "pvs-treatment-suggest",
  /**
   * Nightly per-praxis 90-day cashflow forecast snapshot. Bootstrap Monte
   * Carlo over historical close rates + time-to-close + DSO; writes one row
   * to `forecast_snapshots` per (clinic_id, snapshot_date).
   */
  forecastSnapshot: "forecast-snapshot",
  /**
   * Closed-loop attribution — fire Meta CAPI Purchase event when a
   * PVS InvoicePaid event arrives for a request with fbclid/fbc.
   */
  capiPurchase: "capi-purchase",
  /**
   * Closed-loop attribution — upload an offline conversion to Google
   * Ads (uploadClickConversions) when a PVS InvoicePaid event arrives
   * for a request with gclid/wbraid/gbraid.
   */
  ociPurchase: "oci-purchase",
  /**
   * Dashboard anomaly scanner. Runs every 6h, evaluates rule library
   * against kpi_daily + campaign_snapshots + requests + notifications,
   * upserts active alerts into dashboard_alerts. The "Auffälligkeiten"
   * widget on the praxis dashboard reads from there.
   */
  anomalyScan: "anomaly-scan",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
