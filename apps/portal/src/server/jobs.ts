import "server-only";
import PgBoss from "pg-boss";
import { bossConnectionString } from "@/lib/env";
import { QUEUES, type QueueName, DEFAULT_RETRY } from "@/lib/queues";

export { QUEUES, type QueueName };

/**
 * pg-boss producer-side facade.
 *
 * Worker definitions live under `src/worker/*` (run via `pnpm worker`).
 * Anything that needs to ENQUEUE a job goes through this module so:
 *   - we share a single pg-boss connection across the app
 *   - queue names and default options stay consistent
 *   - a missing/broken queue never rejects the user's action — we log and
 *     return a sentinel so the calling route/server-action can proceed
 *
 * Transport: jobs travel through Postgres (pg-boss), not Redis. The web
 * process is send-only: `migrate`/`supervise`/`schedule` are all off, so it
 * never creates schema, runs maintenance, or fires cron. The always-on worker
 * owns all of that (and creates every queue at boot, before producers send).
 *
 * Failure mode: all `enqueue*` helpers swallow errors and return `null`
 * on failure. Callers decide whether that's acceptable (it usually is —
 * the lead is already persisted; scoring will retry next tick).
 */

// ---------------------------------------------------------------
// Shared connection (lazy singleton)
// ---------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __einsPgBoss: PgBoss | undefined;
  // eslint-disable-next-line no-var
  var __einsPgBossStart: Promise<PgBoss> | undefined;
}

function getBoss(): PgBoss {
  if (!globalThis.__einsPgBoss) {
    const boss = new PgBoss({
      connectionString: bossConnectionString(),
      // Send-only: the always-on worker owns schema migration, maintenance,
      // and cron. The web process must never run any of them.
      migrate: false,
      supervise: false,
      schedule: false,
      // The web process only inserts jobs — a small pool is plenty.
      max: 4,
    });
    // pg-boss is an EventEmitter; an unhandled 'error' would crash the process.
    boss.on("error", (err) =>
      console.error("[jobs][pg-boss]", err instanceof Error ? err.message : err)
    );
    globalThis.__einsPgBoss = boss;
  }
  return globalThis.__einsPgBoss;
}

/**
 * Lazily start the producer boss exactly once. On failure we clear the cached
 * promise so the next enqueue retries — e.g. on a cold cutover where the
 * worker hasn't yet created the `pgboss` schema. Importing this module never
 * connects: the boss is constructed on the first enqueue, which keeps the
 * facade side-effect-free for unit tests.
 */
function ready(): Promise<PgBoss> {
  const boss = getBoss();
  if (!globalThis.__einsPgBossStart) {
    globalThis.__einsPgBossStart = boss.start().catch((err) => {
      globalThis.__einsPgBossStart = undefined;
      throw err;
    });
  }
  return globalThis.__einsPgBossStart;
}

async function safeAdd(
  name: QueueName,
  data: object,
  opts?: PgBoss.SendOptions
): Promise<string | null> {
  try {
    const boss = getBoss();
    await ready(); // ensure the boss has started (once) before sending
    // `send` returns null when a `short`-policy job coalesces with one already
    // queued for the same singletonKey — that's a successful no-op, not a fault.
    return await boss.send(name, data, { ...DEFAULT_RETRY, ...opts });
  } catch (err) {
    console.error(`[jobs] enqueue failed for ${name}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------
// Enqueue helpers
// ---------------------------------------------------------------

/**
 * Score a newly-arrived lead (AI category + score).
 * Called from /api/leads/intake and the manual "rescore" action.
 */
export function enqueueAiScore(requestId: string): Promise<string | null> {
  return safeAdd(QUEUES.aiScore, { requestId });
}

/** Sync campaign snapshots for one clinic+platform. */
export function enqueueCampaignSync(
  clinicId: string,
  platform: "meta" | "google"
): Promise<string | null> {
  const q = platform === "meta" ? QUEUES.syncMeta : QUEUES.syncGoogle;
  return safeAdd(q, { clinicId });
}

/** Recompute kpi_daily rows from raw sources for a date range. */
export function enqueueKpiRebuild(
  clinicId: string,
  from: string,
  to: string
): Promise<string | null> {
  return safeAdd(QUEUES.kpiRebuild, { clinicId, from, to });
}

/** Produce + email the monthly report PDF for one clinic. */
export function enqueueMonthlyReport(
  clinicId: string,
  periodYyyyMm: string
): Promise<string | null> {
  return safeAdd(QUEUES.monthlyReport, { clinicId, period: periodYyyyMm });
}

/**
 * Deliver an email via the configured sender. Used when routes prefer
 * async send.
 *
 * `clinicId` + `klass` are checked against email_suppression in the
 * worker before delivery. Pass both whenever the send is on behalf of a
 * specific clinic — magic-links, feedback alerts, monthly reports, review
 * reminders. Omit only for genuinely cross-tenant ops like Resend test
 * sends; the worker treats `clinicId=null` as "no suppression check".
 */
export function enqueueEmail(payload: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  clinicId?: string | null;
  klass?: "transactional" | "marketing";
  unsubscribeUrl?: string | null;
}): Promise<string | null> {
  return safeAdd(QUEUES.emailSend, payload);
}

// ---------------------------------------------------------------
// PVS Bridge producers
// ---------------------------------------------------------------

/**
 * Replay event-log history for one (clinicId, portalPatientId) tuple and
 * update requests.status, revenue, and patient lifetime_revenue accordingly.
 *
 * The queue uses pg-boss's `short` policy, so passing `singletonKey =
 * ${clinicId}__${patientId}` coalesces concurrent enqueues for the same
 * patient: while a derive job for that key is still queued, additional
 * enqueues are dropped (`send` returns null). The actual idempotency guarantee
 * comes from the processor's full-replay logic — the singletonKey just avoids
 * redundant runs.
 */
export function enqueuePvsStatusDerive(
  clinicId: string,
  portalPatientId: string
): Promise<string | null> {
  return safeAdd(
    QUEUES.pvsStatusDerive,
    { clinicId, portalPatientId },
    { singletonKey: `${clinicId}__${portalPatientId}` }
  );
}

/**
 * Process an uploaded CSV through the pvs-csv-ingest worker. The worker reads
 * `pvs_csv_uploads.storage_key`, applies `mapping_json`, and emits canonical
 * events through `applyPvsEvent` in-process.
 */
export function enqueuePvsCsvIngest(
  uploadId: string
): Promise<string | null> {
  return safeAdd(QUEUES.pvsCsvIngest, { uploadId });
}

/**
 * Re-run the Stage-3 fuzzy linker for one PVS patient id. Triggered by:
 *   • A new pvs_event_log row whose pvsPatientId has no existing map.
 *   • The "Re-check" button on the linking-failures inbox UI.
 *   • The nightly reconciliation job.
 */
export function enqueuePvsLinkBackfill(
  clinicId: string,
  pvsPatientId: string
): Promise<string | null> {
  return safeAdd(QUEUES.pvsLinkBackfill, {
    clinicId,
    pvsPatientId,
  });
}

/**
 * Direction A — write the `EINS-Lead-{8hex}` linking token into the PVS
 * bemerkung field for the patient implied by `requestId`. The processor
 * dispatches per-adapter (Tomedo writes via REST; HealthHub/RED via FHIR
 * Patient.note PATCH; GDT-Agent does NOT support write-back; n8n/CSV are
 * no-ops). For unsupported adapters the token remains only visible in the
 * portal UI for manual MFA copy-paste.
 */
export function enqueuePvsLeadTokenWrite(
  requestId: string
): Promise<string | null> {
  return safeAdd(QUEUES.pvsLeadTokenWrite, { requestId });
}

// ---------------------------------------------------------------
// Closed-loop attribution producers
// ---------------------------------------------------------------

/**
 * Fire a Meta CAPI Purchase event for one outbox row. The queue uses the
 * `short` policy and `singletonKey = capi-purchase__${outboxId}` so a manual
 * retry from the admin UI coalesces with an enqueue already pending for the
 * same outbox row. The real duplicate-suppression guard is the outbox
 * `UNIQUE(clinic_id, channel, pvs_event_log_id)` plus the processor's
 * status check — the singletonKey only trims redundant pending enqueues.
 */
export function enqueueCapiPurchase(outboxId: string): Promise<string | null> {
  return safeAdd(
    QUEUES.capiPurchase,
    { outboxId },
    { singletonKey: `capi-purchase__${outboxId}` }
  );
}

/**
 * Upload a Google Ads offline conversion for one outbox row. Same dedup story
 * as the Meta side: `short` policy + `singletonKey = oci-purchase__${outboxId}`,
 * with the outbox UNIQUE constraint as the real guard.
 */
export function enqueueOciPurchase(outboxId: string): Promise<string | null> {
  return safeAdd(
    QUEUES.ociPurchase,
    { outboxId },
    { singletonKey: `oci-purchase__${outboxId}` }
  );
}

/**
 * Trigger an anomaly scan. With no clinicId, scans every active clinic
 * (matches the every-6h cron behaviour). Use the per-clinic form from
 * tests or an admin debug surface to refresh one praxis on demand.
 */
export function enqueueAnomalyScan(
  clinicId?: string
): Promise<string | null> {
  return safeAdd(QUEUES.anomalyScan, clinicId ? { clinicId } : {});
}
