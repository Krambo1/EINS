import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * SLA breach scan. Runs every 15 minutes via cron.
 *
 * For every clinic with requests where:
 *   - status = neu
 *   - first_contacted_at IS NULL
 *   - sla_respond_by < now()
 *   - AND we haven't yet created a notification for this breach
 *
 * → insert a notification row for every Inhaber + Frontdesk user of that clinic,
 *   and write an audit entry.
 *
 * Idempotency: notification.kind='sla_breach' carries the requestId in `link`
 * as /anfragen/<id>. Before insert we check if such a row already exists.
 */

export interface SlaCheckJob {
  /** Optional: limit to one clinic. Omitted = scan all. */
  clinicId?: string;
}

/** Only breaches from the last 7 days are announced (C-33): after a long
 *  worker pause the first run must not flood the bell with old requests. */
export const SLA_NOTIFY_WINDOW_DAYS = 7;

/**
 * One INSERT ... SELECT with NOT EXISTS (C-33, E-14): no full scan of every
 * sla_breach notification of the platform, no N+1 per request, and the
 * dedupe is per user, so it is idempotent for the worker and the cron alike.
 * The 2-hour deadline itself stays (decided by Karam on 06.10., C-14).
 */
export async function processSlaCheck(job: SlaCheckJob = {}): Promise<void> {
  await runSlaCheck(job);
}

export async function runSlaCheck(job: SlaCheckJob = {}): Promise<number> {
  const clinicFilter = job.clinicId ? sql`AND r.clinic_id = ${job.clinicId}` : sql``;
  const rows = (await db.execute(sql`
    INSERT INTO notifications (user_id, clinic_id, kind, title, body, link)
    SELECT u.id,
           r.clinic_id,
           'sla_breach',
           'Reaktionszeit überschritten',
           CASE WHEN r.contact_name IS NOT NULL AND r.contact_name <> ''
                THEN 'Anfrage von ' || r.contact_name || ' wartet noch auf Antwort.'
                ELSE 'Eine Anfrage wartet noch auf Antwort.' END,
           '/anfragen/' || r.id
      FROM requests r
      JOIN clinic_users u
        ON u.clinic_id = r.clinic_id
       AND u.archived_at IS NULL
       AND u.role IN ('inhaber', 'frontdesk')
     WHERE r.status = 'neu'
       AND r.first_contacted_at IS NULL
       AND r.sla_respond_by < now()
       AND r.sla_respond_by > now() - (${SLA_NOTIFY_WINDOW_DAYS}::int * interval '1 day')
       ${clinicFilter}
       AND NOT EXISTS (
             SELECT 1 FROM notifications n
              WHERE n.user_id = u.id
                AND n.kind = 'sla_breach'
                AND n.link = '/anfragen/' || r.id
           )
    RETURNING id
  `)) as unknown as unknown[];
  return rows.length;
}
