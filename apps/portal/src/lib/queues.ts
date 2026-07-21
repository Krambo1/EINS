/**
 * Queue names + transport defaults — shared between the producer
 * (`src/server/jobs.ts`, which is `server-only`) and the worker entry points
 * under `src/worker/*`, which run as plain Node scripts via `tsx` and cannot
 * import `server-only`.
 *
 * Transport is pg-boss (Postgres-backed). This module holds only the bits that
 * BOTH sides must agree on (names + default options); the worker owns queue
 * creation, scheduling, and processing.
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
   * PVS Bridge: hourly agent liveness scan. Raises the two conditions a
   * heartbeat cannot report about itself: agent gone silent, and agent
   * heartbeating while delivering no events at all.
   */
  pvsAgentHealthScan: "pvs-agent-health-scan",
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

/**
 * Default retry policy applied to every queue (at creation) AND every produced
 * job. Mirrors the previous `{ attempts: 3, backoff: exponential 5s }` policy:
 * pg-boss `retryBackoff: true` grows the delay exponentially from `retryDelay`.
 */
export const DEFAULT_RETRY = {
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
} as const;

/**
 * Queues that previously relied on a custom `jobId` to coalesce
 * redundant enqueues. In pg-boss this maps to the `short` queue policy
 * (at most one job in the `created`/queued state per `singletonKey`) plus a
 * `singletonKey` on the producer side. The real idempotency guard for these
 * still lives in the DB (outbox `UNIQUE(clinic, channel, event)` + derive
 * full-replay); the policy only trims duplicate pending enqueues.
 */
export const DEDUP_QUEUES: ReadonlySet<QueueName> = new Set([
  QUEUES.pvsStatusDerive,
  QUEUES.capiPurchase,
  QUEUES.ociPurchase,
]);

/**
 * The pg-boss work handler is raced against the job's `expireInSeconds`
 * (default 15 min). A 50k-row CSV ingest can run for minutes, so its queue
 * gets a generous expiration window; the processor is idempotent under a
 * double-pick (terminal-status guard + per-event dedup), so this is safe.
 */
export const PVS_CSV_INGEST_EXPIRE_SECONDS = 3600;

/**
 * pg-boss v10 has no LISTEN/NOTIFY — job pickup is poll-based. Queues that are
 * user-facing or cascade-driven poll fast for low latency; everything else
 * (nightly scanners, per-clinic syncs, fan-out dispatchers) polls slowly to
 * keep idle DB load modest. The polling floor in pg-boss is 500ms.
 */
export const LATENCY_SENSITIVE: ReadonlySet<QueueName> = new Set([
  QUEUES.aiScore,
  QUEUES.emailSend,
  QUEUES.pvsCsvIngest,
  QUEUES.pvsStatusDerive,
  QUEUES.pvsLinkBackfill,
  QUEUES.pvsLeadTokenWrite,
  QUEUES.capiPurchase,
  QUEUES.ociPurchase,
]);

export const FAST_POLL_SECONDS = 2;
export const SLOW_POLL_SECONDS = 30;
