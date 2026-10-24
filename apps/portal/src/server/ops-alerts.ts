import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { sendEmailOnce } from "@/server/email-once";

/**
 * Operator (EINS ops) alerting for PVS-bridge incidents.
 *
 * dashboard_alerts rows are shown to that Praxis's own users and nowhere else;
 * nobody at EINS sees a dead agent, a halted stream or a dead worker unless
 * they happen to open the admin page. `notifyOps` closes that gap: for a HIGH
 * (or extreme) severity incident it emails OPS_ALERT_EMAIL directly through
 * `sendEmailOnce` (no pg-boss queue: in production the worker runs at 0, a
 * queued mail would never leave).
 *
 * Rate limit: one email per (clinic, alert) per 6 h, enforced by an atomic
 * upsert on `ops_alert_log` (migration 0079). Postgres, not memory, because the
 * callers run on Vercel (no shared process) and in a worker that restarts.
 * The send itself is keyed `ops/<scope>/<6-h window>` in email_send_log and as
 * Resend Idempotency-Key, so a retry after a crash cannot double-send.
 *
 * `notifyOps` NEVER throws: an alerting failure must not fail a heartbeat, a
 * scan or a health probe.
 *
 * Call sites:
 *   - pvs-agent-health.ts reconcileAgentHealthAlerts (heartbeat + hourly scan)
 *   - worker/processors/pvs-agent-health-scan.ts (dead-letter queue)
 *   - app/api/health (worker_stale)
 * Alerts inserted in files outside this module's owner still need a call:
 *   - server/pvs-events.ts  (pvs_billing_conflict)
 *   - worker/processors/pvs-status-derive.ts (pvs_revenue_swing, pvs_dual_path_revenue)
 *   - worker/processors/pvs-reconcile.ts (pvs_bridge_stale audit row)
 *
 * Env: OPS_ALERT_EMAIL (single recipient). Unset: skip, warn once per process.
 */

export const OPS_ALERT_COOLDOWN_HOURS = 6;

export interface OpsAlert {
  /** null for platform-level incidents (worker, dead-letter queue). */
  clinicId: string | null;
  /** Alert kind plus condition, e.g. "pvs_agent_health:stream_halted". */
  kind: string;
  severity: "info" | "warn" | "high" | "extreme";
  title: string;
  body?: string;
}

export type NotifyOpsResult =
  | "sent"
  | "rate_limited"
  | "skipped"
  | "failed";

let warnedMissingRecipient = false;

/** Test hook: reset the once-per-process warning. */
export function _resetOpsAlertWarning(): void {
  warnedMissingRecipient = false;
}

/**
 * INT-C 11: only PVS alerts (kind "pvs_...") carry the PVS prefix and the
 * link to the PVS alert list; everything else (worker, Meta, retention,
 * backup) is "[EINS Portal]".
 */
export function opsAlertPresentation(kind: string): { prefix: string; footer: string | null } {
  return kind.startsWith("pvs_")
    ? { prefix: "[EINS PVS]", footer: "Alle offenen PVS-Alarme: /api/admin/pvs/alerts (Admin-Login)" }
    : { prefix: "[EINS Portal]", footer: null };
}

export function opsAlertScopeKey(
  alert: Pick<OpsAlert, "clinicId" | "kind">
): string {
  return `${alert.clinicId ?? "platform"}:${alert.kind}`;
}

/**
 * Idempotency key for one alert mail: scope plus the 6-h window it falls in.
 * Two claims of the cooldown are at least 6 h apart, so they never share a
 * window, and a retry within the same window reuses the key.
 */
export function opsAlertSendKey(
  alert: Pick<OpsAlert, "clinicId" | "kind">,
  now: Date = new Date()
): string {
  const windowMs = OPS_ALERT_COOLDOWN_HOURS * 60 * 60 * 1000;
  const window = Math.floor(now.getTime() / windowMs);
  return `ops/${opsAlertScopeKey(alert)}/${window}`;
}

export async function notifyOps(alert: OpsAlert): Promise<NotifyOpsResult> {
  try {
    if (alert.severity !== "high" && alert.severity !== "extreme") {
      return "skipped";
    }
    const to = process.env.OPS_ALERT_EMAIL?.trim();
    if (!to) {
      if (!warnedMissingRecipient) {
        warnedMissingRecipient = true;
        console.warn(
          "[ops-alerts] OPS_ALERT_EMAIL is not set; PVS operator alerts are not emailed."
        );
      }
      return "skipped";
    }

    // Atomic claim: the row is inserted, or refreshed only when the previous
    // email is older than the cooldown. No RETURNING row = rate limited.
    const scopeKey = opsAlertScopeKey(alert);
    const claimed = (await db.execute(sql`
      INSERT INTO ops_alert_log (scope_key, last_sent_at)
      VALUES (${scopeKey}, now())
      ON CONFLICT (scope_key) DO UPDATE SET last_sent_at = now()
        WHERE ops_alert_log.last_sent_at
          < now() - (${OPS_ALERT_COOLDOWN_HOURS}::int * interval '1 hour')
      RETURNING scope_key
    `)) as unknown as unknown[];
    if (claimed.length === 0) return "rate_limited";

    let clinicLabel = "Plattform";
    if (alert.clinicId) {
      clinicLabel = alert.clinicId;
      try {
        const [c] = await db
          .select({ name: schema.clinics.displayName })
          .from(schema.clinics)
          .where(eq(schema.clinics.id, alert.clinicId))
          .limit(1);
        if (c?.name) clinicLabel = `${c.name} (${alert.clinicId})`;
      } catch {
        // label only; the id is enough to act on
      }
    }

    const { prefix, footer } = opsAlertPresentation(alert.kind);
    const text = [
      `${prefix} ${alert.title}`,
      "",
      `Praxis: ${clinicLabel}`,
      `Art: ${alert.kind}`,
      `Schweregrad: ${alert.severity}`,
      ...(alert.body ? ["", alert.body] : []),
      "",
      ...(footer ? [footer] : []),
      `Pro Praxis und Alarmart höchstens eine Mail alle ${OPS_ALERT_COOLDOWN_HOURS} Stunden.`,
    ].join("\n");

    let result: Awaited<ReturnType<typeof sendEmailOnce>>;
    try {
      result = await sendEmailOnce({
        key: opsAlertSendKey(alert),
        to,
        subject: `${prefix} ${alert.title}`.slice(0, 200),
        text,
        clinicId: null, // cross-tenant ops mail: no suppression check
        klass: "transactional",
      });
    } catch (err) {
      // Send failed (sendEmailOnce already released its ledger key): release
      // the cooldown claim too so the next evaluation retries.
      await db
        .execute(sql`DELETE FROM ops_alert_log WHERE scope_key = ${scopeKey}`)
        .catch(() => undefined);
      console.error("[ops-alerts] send failed:", err);
      return "failed";
    }
    if (result !== "sent") return "rate_limited";
    return "sent";
  } catch (err) {
    console.error("[ops-alerts] notifyOps failed:", err);
    return "failed";
  }
}
